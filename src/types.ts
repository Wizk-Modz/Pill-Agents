// Kiểu dữ liệu dùng chung cho agent và giao diện.
export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type ToolMeta = {
  durationMs?: number;
  exitCode?: number;
};

export type ToolResult = {
  content: string;
  isError?: boolean;
  meta?: ToolMeta;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  needsApproval: boolean;
  run: (args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>;
};

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};
