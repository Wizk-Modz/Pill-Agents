// Client gọi endpoint chat completions tương thích OpenAI, có streaming.
import type { ChatMessage, ToolCall, ToolSpec } from './types.js';

type WireTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

// Chuyển message nội bộ sang định dạng API.
function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'assistant') {
    const wire: Record<string, unknown> = { role: 'assistant', content: message.content };
    if (message.toolCalls?.length) {
      wire.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    return wire;
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
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const wireTools: WireTool[] = options.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages.map(toWireMessage),
      tools: wireTools.length ? wireTools : undefined,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    throw new Error(`API trả về ${response.status}: ${body.slice(0, 500)}`);
  }

  // Proxy có thể bỏ qua stream và trả JSON thường.
  if (response.headers.get('content-type')?.includes('application/json')) {
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const message = payload.choices?.[0]?.message;
    if (message?.reasoning_content) options.onReasoning?.(message.reasoning_content);
    const content = message?.content ?? '';
    if (content) options.onText(content);
    const toolCalls = (message?.tool_calls ?? []).map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.function?.name ?? '',
      arguments: call.function?.arguments ?? '',
    }));
    return { content, toolCalls };
  }

  let content = '';
  const calls = new Map<number, ToolCall>();
  let buffer = '';
  const decoder = new TextDecoder();

  // Xử lý một dòng SSE, bỏ qua dòng không phải dữ liệu.
  const handleLine = (raw: string): void => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return;
    let parsed: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;
    // Hỗ trợ cả reasoning_content (DeepSeek/OpenRouter) và reasoning (một số proxy).
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (reasoning) options.onReasoning?.(reasoning);
    if (delta.content) {
      content += delta.content;
      options.onText(delta.content);
    }
    if (delta.tool_calls) mergeToolCallDelta(calls, delta.tool_calls);
  };

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }));
  return { content, toolCalls };
}
