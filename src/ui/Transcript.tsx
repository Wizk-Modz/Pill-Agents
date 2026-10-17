// Chuyển transcript thành các dòng ANSI, render markdown cho câu trả lời.
import type { ToolCall, ToolResult } from '../types.js';
import { paintSegments, renderMarkdown, renderStyledText, type Segment } from './markdown.js';

export type ItemBody =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string; expanded?: boolean; seconds?: number }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'tool'; call: ToolCall; result?: ToolResult; summary?: string };

export type TranscriptItem = ItemBody & { id: number };

const RESULT_MAX_LINES = 5;
const RESULT_MAX_CHARS = 400;
const THINKING_MAX_LINES = 10;

// Phân tích tham số tool để hiển thị, trả object rỗng nếu JSON lỗi.
function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Tạo dòng mô tả ngắn gọn cho từng loại tool.
export function summarizeToolCall(call: ToolCall): string {
  const args = parseArgs(call);
  switch (call.name) {
    case 'bash':
      return String(args.command ?? '');
    case 'grep':
      return `${args.pattern ?? ''}${args.path ? ` trong ${args.path}` : ''}`;
    case 'glob':
      return String(args.pattern ?? '');
    default:
      return String(args.path ?? '');
  }
}

// Cắt kết quả tool để hiển thị gọn, tránh lag khi output lớn.
export function clipToolResult(content: string): string[] {
  const lines = content.split('\n');
  const shown: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (shown.length >= RESULT_MAX_LINES || chars >= RESULT_MAX_CHARS) break;
    const clipped = line.length > 160 ? `${line.slice(0, 160)}…` : line;
    shown.push(clipped);
    chars += clipped.length;
  }
  const hidden = lines.length - shown.length;
  if (hidden > 0) shown.push(`… +${hidden} dòng`);
  return shown;
}

// Thêm tiền tố vào dòng đầu, thụt lề các dòng sau.
function prefixLines(lines: Segment[][], first: Segment[], rest: Segment[]): Segment[][] {
  return lines.map((line, index) => [...(index === 0 ? first : rest), ...line]);
}

// Render tool call kèm kết quả rút gọn.
function toolLines(item: Extract<ItemBody, { kind: 'tool' }>, width: number): string[] {
  const summary = (item.summary ?? summarizeToolCall(item.call)).replace(/\s+/g, ' ').slice(0, Math.max(20, width - 20));
  const glyph = item.result ? (item.result.isError ? '✗' : '✓') : '●';
  const color = item.result ? (item.result.isError ? 'red' : 'green') : 'yellow';
  const lines = [
    paintSegments([
      { text: `  ${glyph} `, color },
      { text: item.call.name, bold: true },
      { text: ` ${summary}`, dim: true },
    ]),
  ];
  if (item.result) {
    for (const line of clipToolResult(item.result.content)) {
      lines.push(paintSegments([{ text: `    ${line}`, dim: true, color: item.result.isError ? 'red' : undefined }]));
    }
  }
  return lines;
}

// Render một mục transcript thành các dòng ANSI.
export function itemToLines(item: TranscriptItem, width: number): string[] {
  switch (item.kind) {
    case 'user': {
      const lines = renderStyledText(item.text, width - 2, { color: 'cyan', bold: true });
      return [
        '',
        ...prefixLines(lines, [{ text: '❯ ', color: 'cyan', bold: true }], [{ text: '  ' }]).map(paintSegments),
      ];
    }
    case 'assistant': {
      const lines = renderMarkdown(item.text, width - 2);
      return ['', ...prefixLines(lines, [{ text: '  ' }], [{ text: '  ' }]).map(paintSegments)];
    }
    case 'thinking': {
      // Sau khi xong, khối thinking thu gọn thành một dòng; ấn Ctrl+O để mở lại.
      const label = item.seconds ? `Thought for ${item.seconds}s` : 'Thinking';
      if (item.expanded === false) {
        return [paintSegments([{ text: `  ✻ ${label} (ctrl+o để xem)`, color: 'gray', dim: true, italic: true }])];
      }
      const tail = item.text.split('\n').slice(-THINKING_MAX_LINES);
      const lines = renderStyledText(tail.join('\n'), width - 4, { dim: true, italic: true, color: 'gray' });
      return [
        paintSegments([{ text: `  ✻ ${label}`, color: 'gray', dim: true, italic: true }]),
        ...lines.map((line) => paintSegments([{ text: '    ' }, ...line])),
      ];
    }
    case 'info':
      return renderStyledText(item.text, width - 2, { dim: true }).map((line) =>
        paintSegments([{ text: '  ' }, ...line]),
      );
    case 'error':
      return renderStyledText(item.text, width - 4, { color: 'red' }).map((line, index) =>
        paintSegments([{ text: index === 0 ? '  ✗ ' : '    ', color: 'red' }, ...line]),
      );
    case 'tool':
      return toolLines(item, width);
  }
}
