// Vòng lặp agent: gọi model, xử lý tool call và lưu phiên.
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadInstructions, renderInstructions } from './instructions.js';
import { streamChat } from './llm.js';
import { composePrompt, type PromptContext } from './prompt.js';
import type { Config } from './config.js';
import type { AgentMode, ChatMessage, ToolCall, ToolResult, ToolSpec, Usage } from './types.js';

const PLAN_TOOLS = new Set(['Read', 'grep', 'Glob']);

export type AgentHandlers = {
  onAssistantStart: () => void;
  onText: (chunk: string) => void;
  onThinking: (chunk: string) => void;
  onToolCall: (call: ToolCall) => void;
  onToolResult: (call: ToolCall, result: ToolResult) => void;
  onUsage: (usage: Usage) => void;
  onTurnEnd: () => void;
  approve: (call: ToolCall) => Promise<boolean>;
};

// Phát hiện thư mục làm việc có phải git repo, để prompt không giả định sai.
function detectGitRepo(cwd: string): boolean {
  return existsSync(path.join(cwd, '.git'));
}

// Tạo system prompt chi tiết, gắn với thư mục làm việc và chế độ hiện tại.
export function buildSystemPrompt(cwd: string, mode: AgentMode = 'build'): string {
  const context: PromptContext = { cwd, isGitRepo: detectGitRepo(cwd) };
  return composePrompt(mode, context);
}

// Lọc tool được phép dùng theo chế độ; plan chỉ giữ tool đọc.
export function toolsForMode(tools: ToolSpec[], mode: AgentMode): ToolSpec[] {
  return mode === 'plan' ? tools.filter((tool) => PLAN_TOOLS.has(tool.name)) : tools;
}

// Ghép system prompt của từng chế độ với nội dung các file PILL.md đã nạp.
function composeSystemPrompts(cwd: string, configDir: string): Record<AgentMode, string> {
  const instructions = renderInstructions(loadInstructions(cwd, configDir));
  const compose = (mode: AgentMode): string => {
    const base = buildSystemPrompt(cwd, mode);
    return instructions ? `${base}\n\n${instructions}` : base;
  };
  return { build: compose('build'), plan: compose('plan') };
}

// Quản lý hội thoại và thực thi tool cho một phiên làm việc.
export class Agent {
  readonly sessionFile: string;
  private messages: ChatMessage[];
  private readonly config: Config;
  private readonly tools: ToolSpec[];
  private readonly toolMap: Map<string, ToolSpec>;
  private prompts: Record<AgentMode, string>;

  constructor(config: Config, tools: ToolSpec[]) {
    this.config = config;
    this.tools = tools;
    this.toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    this.prompts = composeSystemPrompts(config.cwd, config.configDir);
    this.messages = [{ role: 'system', content: this.prompts[config.mode] }];
    this.sessionFile = path.join(
      config.configDir,
      'sessions',
      `${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
  }

  // Xoá hội thoại hiện tại, nạp lại PILL.md và bắt đầu phiên mới.
  reset(): void {
    this.prompts = composeSystemPrompts(this.config.cwd, this.config.configDir);
    this.messages = [{ role: 'system', content: this.prompts[this.config.mode] }];
  }

  // Chạy một lượt người dùng đến khi model trả lời xong hoặc hết số bước.
  async send(input: string, signal: AbortSignal, handlers: AgentHandlers): Promise<void> {
    // Chốt chế độ ở đầu lượt để đổi chế độ giữa chừng không làm lệch tool đã gửi model.
    const mode = this.config.mode;
    const tools = toolsForMode(this.tools, mode);
    const toolMap = mode === 'plan' ? new Map(tools.map((tool) => [tool.name, tool])) : this.toolMap;
    this.messages[0] = { role: 'system', content: this.prompts[mode] };
    this.messages.push({ role: 'user', content: input });
    try {
      const maxSteps = this.config.maxSteps;
      for (let step = 0; maxSteps === undefined || step < maxSteps; step++) {
        if (signal.aborted) return;
        handlers.onAssistantStart();
        let response: { content: string; toolCalls: ToolCall[]; usage?: Usage };
        try {
          response = await streamChat({
            baseUrl: this.config.baseUrl,
            apiKey: this.config.apiKey,
            model: this.config.model,
            messages: this.messages,
            tools,
            signal,
            onText: handlers.onText,
            onReasoning: handlers.onThinking,
            effort: this.config.effort,
          });
        } catch (error) {
          if (signal.aborted) return;
          throw error;
        }

        this.messages.push({
          role: 'assistant',
          content: response.content || null,
          toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
        });
        if (response.usage) handlers.onUsage(response.usage);

        if (!response.toolCalls.length) {
          handlers.onTurnEnd();
          return;
        }

        const aborted = await this.runToolCalls(response.toolCalls, signal, handlers, toolMap, mode);
        if (aborted) return;
      }
      throw new Error(`Đã đạt giới hạn ${maxSteps} bước trong một lượt.`);
    } finally {
      await this.saveSession();
    }
  }

  // Thực thi lần lượt các tool call được phép; trả true nếu bị huỷ giữa chừng.
  private async runToolCalls(
    calls: ToolCall[],
    signal: AbortSignal,
    handlers: AgentHandlers,
    toolMap: Map<string, ToolSpec>,
    mode: AgentMode,
  ): Promise<boolean> {
    for (let index = 0; index < calls.length; index++) {
      const call = calls[index]!;
      if (signal.aborted) {
        this.pushCancelled(calls.slice(index), handlers);
        return true;
      }
      handlers.onToolCall(call);
      const tool = toolMap.get(call.name);
      if (!tool) {
        const reason = this.toolMap.has(call.name)
          ? `Tool ${call.name} bị khoá ở chế độ ${mode}.`
          : `Tool không tồn tại: ${call.name}`;
        this.pushToolResult(call, { content: reason, isError: true }, handlers);
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        this.pushToolResult(call, { content: 'Tham số tool không phải JSON hợp lệ.', isError: true }, handlers);
        continue;
      }

      if (tool.needsApproval) {
        const approved = await handlers.approve(call);
        if (signal.aborted || !approved) {
          const reason = signal.aborted ? 'Đã huỷ bởi người dùng.' : 'Người dùng đã từ chối thực hiện tool này.';
          this.pushToolResult(call, { content: reason, isError: true }, handlers);
          if (signal.aborted) {
            this.pushCancelled(calls.slice(index + 1), handlers);
            return true;
          }
          continue;
        }
      }

      let result: ToolResult;
      const startedAt = Date.now();
      try {
        result = await tool.run(args, signal);
      } catch (error) {
        if (signal.aborted) {
          this.pushCancelled(calls.slice(index), handlers);
          return true;
        }
        result = { content: error instanceof Error ? error.message : String(error), isError: true };
      }
      // Thời gian chỉ dùng cho giao diện, không đưa vào nội dung gửi model.
      result = { ...result, meta: { ...result.meta, durationMs: Date.now() - startedAt } };
      // Lượt có thể bị huỷ trong lúc tool đang chạy; vẫn ghi kết quả để hội thoại hợp lệ.
      this.pushToolResult(call, result, handlers);
      if (signal.aborted) {
        this.pushCancelled(calls.slice(index + 1), handlers);
        return true;
      }
    }
    return false;
  }

  // Ghi kết quả tool vào hội thoại và báo cho giao diện.
  private pushToolResult(call: ToolCall, result: ToolResult, handlers: AgentHandlers): void {
    this.messages.push({
      role: 'tool',
      toolCallId: call.id,
      content: result.isError ? `Error: ${result.content}` : result.content,
    });
    handlers.onToolResult(call, result);
  }

  // Đánh dấu các tool call chưa chạy là đã huỷ để giữ hội thoại hợp lệ.
  private pushCancelled(calls: ToolCall[], handlers: AgentHandlers): void {
    for (const call of calls) {
      this.pushToolResult(call, { content: 'Đã huỷ bởi người dùng.', isError: true }, handlers);
    }
  }

  // Lưu phiên ra đĩa, bỏ qua lỗi vì đây là tính năng phụ.
  private async saveSession(): Promise<void> {
    try {
      await mkdir(path.dirname(this.sessionFile), { recursive: true });
      await writeFile(
        this.sessionFile,
        JSON.stringify(
          { model: this.config.model, mode: this.config.mode, cwd: this.config.cwd, messages: this.messages },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      // Không chặn agent nếu lưu phiên thất bại.
    }
  }
}
