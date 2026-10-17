// Vòng lặp agent: gọi model, xử lý tool call và lưu phiên.
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { streamChat } from './llm.js';
import type { Config } from './config.js';
import type { ChatMessage, ToolCall, ToolResult, ToolSpec } from './types.js';

export type AgentHandlers = {
  onAssistantStart: () => void;
  onText: (chunk: string) => void;
  onThinking: (chunk: string) => void;
  onToolCall: (call: ToolCall) => void;
  onToolResult: (call: ToolCall, result: ToolResult) => void;
  onTurnEnd: () => void;
  approve: (call: ToolCall) => Promise<boolean>;
};

// Tạo system prompt chi tiết, gắn với thư mục làm việc.
function buildSystemPrompt(cwd: string): string {
  return [
    `Bạn là PillAgents, coding agent chạy trong terminal tại ${cwd}.`,
    'Bạn hỗ trợ người dùng làm việc với code: đọc hiểu, viết mới, sửa lỗi, chạy lệnh và kiểm thử.',
    '',
    '## Nguyên tắc chung',
    '- Trả lời ngắn gọn, đúng trọng tâm, bằng ngôn ngữ của người dùng.',
    '- Không đoán mò: đọc file và kiểm tra thực tế trước khi kết luận.',
    '- Chỉ thực hiện đúng phạm vi yêu cầu; không tự ý refactor hay thêm tính năng ngoài scope.',
    '- Không tạo file tài liệu mới trừ khi được yêu cầu rõ.',
    '- Nếu yêu cầu mơ hồ và có nhiều cách hiểu khác nhau, hỏi lại thay vì tự chọn.',
    '',
    '## Dùng tool',
    '- Luôn đọc file trước khi sửa; không sửa dựa trên phỏng đoán nội dung.',
    '- Ưu tiên edit_file với chuỗi chính xác thay vì ghi lại toàn bộ file.',
    '- Nếu edit_file báo chuỗi khớp nhiều lần, dùng chuỗi dài hơn hoặc replace_all.',
    '- Dùng glob và grep để định vị file thay vì quét toàn bộ dự án.',
    '- Có thể gọi nhiều tool trong một lượt khi chúng độc lập với nhau.',
    '- Sau khi sửa file, chạy build/lint/test của dự án nếu có cấu hình sẵn.',
    '',
    '## An toàn',
    '- Không chạy lệnh phá huỷ (rm -rf, git reset --hard, git checkout --) trừ khi được yêu cầu rõ.',
    '- Không commit, push hay tạo branch trừ khi được yêu cầu rõ.',
    '- Không ghi đè file ngoài phạm vi yêu cầu.',
    '- Không đưa secrets, API key hay thông tin xác thực vào code hoặc output.',
    '',
    '## Định dạng',
    '- Dùng markdown cho câu trả lời: tiêu đề, danh sách, khối code có nhãn ngôn ngữ.',
    '- Trích dẫn vị trí code dạng đường_dẫn: dòng khi tham chiếu file cụ thể.',
    '- Nêu rõ việc đã làm và kết quả; nói thẳng nếu có bước thất bại hoặc bị bỏ qua.',
  ].join('\n');
}

// Quản lý hội thoại và thực thi tool cho một phiên làm việc.
export class Agent {
  readonly sessionFile: string;
  private messages: ChatMessage[];
  private readonly config: Config;
  private readonly tools: ToolSpec[];
  private readonly toolMap: Map<string, ToolSpec>;

  constructor(config: Config, tools: ToolSpec[]) {
    this.config = config;
    this.tools = tools;
    this.toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    this.messages = [{ role: 'system', content: buildSystemPrompt(config.cwd) }];
    this.sessionFile = path.join(
      homedir(),
      '.pill',
      'sessions',
      `${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
  }

  // Trả về system prompt hiện tại để giao diện hiển thị.
  systemPrompt(): string {
    return buildSystemPrompt(this.config.cwd);
  }

  // Xoá hội thoại hiện tại và bắt đầu phiên mới.
  reset(): void {
    this.messages = [{ role: 'system', content: buildSystemPrompt(this.config.cwd) }];
  }

  // Chạy một lượt người dùng đến khi model trả lời xong hoặc hết số bước.
  async send(input: string, signal: AbortSignal, handlers: AgentHandlers): Promise<void> {
    this.messages.push({ role: 'user', content: input });
    try {
      for (let step = 0; step < this.config.maxSteps; step++) {
        if (signal.aborted) return;
        handlers.onAssistantStart();
        let response: { content: string; toolCalls: ToolCall[] };
        try {
          response = await streamChat({
            baseUrl: this.config.baseUrl,
            apiKey: this.config.apiKey,
            model: this.config.model,
            messages: this.messages,
            tools: this.tools,
            signal,
            onText: handlers.onText,
            onReasoning: handlers.onThinking,
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

        if (!response.toolCalls.length) {
          handlers.onTurnEnd();
          return;
        }

        const aborted = await this.runToolCalls(response.toolCalls, signal, handlers);
        if (aborted) return;
      }
      throw new Error(`Đã đạt giới hạn ${this.config.maxSteps} bước trong một lượt.`);
    } finally {
      await this.saveSession();
    }
  }

  // Thực thi lần lượt các tool call; trả true nếu bị huỷ giữa chừng.
  private async runToolCalls(calls: ToolCall[], signal: AbortSignal, handlers: AgentHandlers): Promise<boolean> {
    for (let index = 0; index < calls.length; index++) {
      const call = calls[index]!;
      if (signal.aborted) {
        this.pushCancelled(calls.slice(index), handlers);
        return true;
      }
      handlers.onToolCall(call);
      const tool = this.toolMap.get(call.name);
      if (!tool) {
        this.pushToolResult(call, { content: `Tool không tồn tại: ${call.name}`, isError: true }, handlers);
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
      try {
        result = await tool.run(args, signal);
      } catch (error) {
        if (signal.aborted) {
          this.pushCancelled(calls.slice(index), handlers);
          return true;
        }
        result = { content: error instanceof Error ? error.message : String(error), isError: true };
      }
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
        JSON.stringify({ model: this.config.model, cwd: this.config.cwd, messages: this.messages }, null, 2),
        'utf8',
      );
    } catch {
      // Không chặn agent nếu lưu phiên thất bại.
    }
  }
}
