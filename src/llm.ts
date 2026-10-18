// Client gọi endpoint chat completions tương thích OpenAI qua SDK chính thức.
import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ChatMessage, ToolCall, ToolSpec, Usage } from './types.js';
import type { Effort } from './config.js';

// Trường mở rộng của proxy, không có trong type chuẩn của SDK.
type DeltaExtras = {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

// Chuyển message nội bộ sang định dạng API.
function toWireMessage(message: ChatMessage): ChatCompletionMessageParam {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  return { role: message.role, content: message.content };
}

// Gom các mảnh tool call stream về một danh sách hoàn chỉnh.
function mergeToolCallDelta(
  calls: Map<number, ToolCall>,
  deltas: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>,
): void {
  for (const delta of deltas) {
    const current = calls.get(delta.index) ?? { id: '', name: '', arguments: '' };
    if (delta.id) current.id = delta.id;
    if (delta.function?.name) current.name += delta.function.name;
    if (delta.function?.arguments) current.arguments += delta.function.arguments;
    calls.set(delta.index, current);
  }
}

// Chuyển danh sách tool call đã gom sang kết quả trả về.
function collectToolCalls(calls: Map<number, ToolCall>): ToolCall[] {
  return [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }));
}

// Gọi model một lượt, phát text qua callback và trả về message assistant.
export async function streamChat(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  effort?: Effort;
}): Promise<{ content: string; toolCalls: ToolCall[]; usage?: Usage }> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl.replace(/\/$/, ''),
    maxRetries: 2,
  });

  const tools: ChatCompletionTool[] = options.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const params = {
    model: options.model,
    messages: options.messages.map(toWireMessage),
    ...(tools.length ? { tools } : {}),
    ...(options.effort ? { reasoning_effort: options.effort } : {}),
  };

  let content = '';
  const calls = new Map<number, ToolCall>();
  let chunks = 0;

  const stream = await client.chat.completions.create(
    { ...params, stream: true, stream_options: { include_usage: true } },
    { signal: options.signal },
  );
  let usage: Usage | undefined;
  for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
    chunks += 1;
    // Chunk cuối cùng chứa usage; các chunk khác có usage null.
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
    }
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    // Hỗ trợ cả reasoning_content (DeepSeek/OpenRouter) và reasoning (một số proxy).
    const extras = delta as DeltaExtras;
    const reasoning = extras.reasoning_content ?? extras.reasoning;
    if (reasoning) options.onReasoning?.(reasoning);
    if (delta.content) {
      content += delta.content;
      options.onText(delta.content);
    }
    if (delta.tool_calls) mergeToolCallDelta(calls, delta.tool_calls);
  }

  // Proxy bỏ qua stream và trả JSON thường: gọi lại không stream để lấy dữ liệu.
  if (!chunks) {
    const completion = await client.chat.completions.create(params, { signal: options.signal });
    const message = completion.choices[0]?.message;
    if (!message) return { content: '', toolCalls: [], usage };
    const extras = message as DeltaExtras;
    if (extras.reasoning_content) options.onReasoning?.(extras.reasoning_content);
    if (message.content) {
      content = message.content;
      options.onText(content);
    }
    // SDK 7.x có thêm custom tool call không kèm trường function; chỉ nhận function call.
    const toolCalls = (message.tool_calls ?? [])
      .filter((call) => call.type === 'function')
      .map((call, index) => ({
        id: call.id || `call_${index}`,
        name: call.function.name,
        arguments: call.function.arguments,
      }));
    const fallbackUsage = completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : usage;
    return { content, toolCalls, usage: fallbackUsage };
  }

  return { content, toolCalls: collectToolCalls(calls), usage };
}
