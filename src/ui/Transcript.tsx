// Chuyển transcript thành các dòng ANSI, render markdown và thẻ tool có thể mở rộng.
import type { ToolCall, ToolResult } from '../types.js';
import { diffLines, type DiffResult } from './diff.js';
import { formatDuration, fitText, padBetween, visibleWidth } from './format.js';
import { paintSegments, renderMarkdown, renderStyledText, type Segment } from './markdown.js';
import { COLORS, GLYPHS, toolIcon } from './theme.js';

export type ItemBody =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string; expanded?: boolean; seconds?: number }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'tool'; call: ToolCall; result?: ToolResult; summary?: string; expanded?: boolean };

export type TranscriptItem = ItemBody & { id: number };

const RESULT_MAX_LINES = 5;
const RESULT_MAX_CHARS = 400;
const RESULT_EXPANDED_LINES = 40;
const RESULT_EXPANDED_CHARS = 4000;
const THINKING_MAX_LINES = 10;
const TOOL_PREFIX_WIDTH = 8;
const TOOL_RAIL = `      ${GLYPHS.rail} `;

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
export function clipToolResult(
  content: string,
  maxLines = RESULT_MAX_LINES,
  maxChars = RESULT_MAX_CHARS,
): string[] {
  const lines = content.split('\n');
  const shown: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (shown.length >= maxLines || chars >= maxChars) break;
    const clipped = line.length > 160 ? `${line.slice(0, 160)}…` : line;
    shown.push(clipped);
    chars += clipped.length;
  }
  const hidden = lines.length - shown.length;
  if (hidden > 0) shown.push(`… +${hidden} dòng`);
  return shown;
}

// Tính diff của edit_file từ tham số, trả undefined nếu thiếu chuỗi.
function editDiff(call: ToolCall): DiffResult | undefined {
  if (call.name !== 'edit_file') return undefined;
  const args = parseArgs(call);
  if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') return undefined;
  return diffLines(args.old_string, args.new_string, 400);
}

// Tạo phần thống kê ngắn trên header của thẻ tool.
function toolStats(item: Extract<ItemBody, { kind: 'tool' }>, diff: DiffResult | undefined): string {
  const result = item.result;
  if (!result) return '';
  const parts: string[] = [];
  if (result.meta?.durationMs !== undefined) parts.push(formatDuration(result.meta.durationMs));
  if (diff && !result.isError) {
    parts.push(`+${diff.added} −${diff.removed}`);
  } else if (!result.isError && item.call.name === 'read_file') {
    parts.push(`${result.content.split('\n').length} dòng`);
  } else if (!result.isError && (item.call.name === 'grep' || item.call.name === 'glob')) {
    const count = result.content.split('\n').filter(Boolean).length;
    parts.push(`${count} kết quả`);
  } else if (item.call.name === 'write_file') {
    const args = parseArgs(item.call);
    if (typeof args.content === 'string') parts.push(`${args.content.split('\n').length} dòng`);
  }
  if (item.call.name === 'bash') {
    const exitCode = result.meta?.exitCode;
    if (exitCode !== undefined && exitCode !== 0) parts.push(`exit ${exitCode}`);
  }
  return parts.join(' · ');
}

// Render một dòng diff kèm dấu và màu tương ứng.
function diffLine(line: DiffResult['lines'][number], width: number): string {
  const marker = line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  ';
  const color = line.kind === 'add' ? COLORS.success : line.kind === 'remove' ? COLORS.danger : undefined;
  const text = fitText(line.text, Math.max(10, width - TOOL_PREFIX_WIDTH - 2));
  return paintSegments([
    { text: TOOL_RAIL, color: COLORS.border, dim: true },
    { text: marker, color },
    { text, color, dim: line.kind === 'context' },
  ]);
}

// Render thẻ tool: header một dòng, kết quả hoặc diff bên dưới.
function toolLines(item: Extract<ItemBody, { kind: 'tool' }>, width: number): string[] {
  const diff = editDiff(item.call);
  const stats = toolStats(item, diff);
  const pending = !item.result;
  const glyph = pending ? GLYPHS.pending : item.result!.isError ? GLYPHS.error : GLYPHS.success;
  const statusColor = pending ? COLORS.warning : item.result!.isError ? COLORS.danger : COLORS.success;
  const marker = item.result ? (item.expanded ? GLYPHS.collapse : GLYPHS.expand) : ' ';
  const summaryRaw = (item.summary ?? summarizeToolCall(item.call)).replace(/\s+/g, ' ').trim();
  const statsText = stats ? paintSegments([{ text: stats, color: COLORS.muted, dim: true }]) : '';
  const statsWidth = stats ? visibleWidth(statsText) : 0;
  const showStats = statsWidth > 0 && TOOL_PREFIX_WIDTH + item.call.name.length + statsWidth + 4 <= width;
  const room = width - TOOL_PREFIX_WIDTH - item.call.name.length - 2 - (showStats ? statsWidth + 2 : 0);
  const summary = room >= 4 ? fitText(summaryRaw, room) : '';
  const left = paintSegments([
    { text: '  ' },
    { text: `${marker} `, color: COLORS.muted, dim: true },
    { text: `${glyph} `, color: statusColor },
    { text: `${toolIcon(item.call.name)} `, color: COLORS.muted },
    { text: item.call.name, bold: true },
    ...(summary ? [{ text: `  ${summary}`, dim: true } as Segment] : []),
  ]);
  const header = showStats ? padBetween(left, statsText, width, 2) : left;
  const lines = ['', header];
  if (!item.result) return lines;

  const maxLines = item.expanded ? RESULT_EXPANDED_LINES : RESULT_MAX_LINES;
  const maxChars = item.expanded ? RESULT_EXPANDED_CHARS : RESULT_MAX_CHARS;
  if (diff && !item.result.isError) {
    const visible = diff.lines.slice(0, maxLines);
    for (const line of visible) lines.push(diffLine(line, width));
    const hidden = diff.lines.length - visible.length;
    if (hidden > 0) {
      lines.push(
        paintSegments([
          { text: TOOL_RAIL, color: COLORS.border, dim: true },
          { text: `… +${hidden} dòng`, color: COLORS.muted, dim: true },
        ]),
      );
    }
    return lines;
  }

  const clipped = clipToolResult(item.result.content, maxLines, maxChars);
  for (const line of clipped) {
    lines.push(
      paintSegments([
        { text: TOOL_RAIL, color: item.result.isError ? COLORS.danger : COLORS.border, dim: true },
        {
          text: fitText(line, Math.max(10, width - TOOL_PREFIX_WIDTH)),
          dim: true,
          color: item.result.isError ? COLORS.danger : undefined,
        },
      ]),
    );
  }
  return lines;
}

// Thêm tiền tố vào dòng đầu, thụt lề các dòng sau.
function prefixLines(lines: Segment[][], first: Segment[], rest: Segment[]): Segment[][] {
  return lines.map((line, index) => [...(index === 0 ? first : rest), ...line]);
}

// Render một mục transcript thành các dòng ANSI.
export function itemToLines(item: TranscriptItem, width: number): string[] {
  switch (item.kind) {
    case 'user': {
      const lines = renderStyledText(item.text, width - 4, { bold: true });
      return [
        '',
        ...prefixLines(
          lines,
          [{ text: `  ${GLYPHS.prompt} `, color: COLORS.accent, bold: true }],
          [{ text: '    ' }],
        ).map(paintSegments),
      ];
    }
    case 'assistant': {
      const lines = renderMarkdown(item.text, width - 2);
      return ['', ...prefixLines(lines, [{ text: '  ' }], [{ text: '  ' }]).map(paintSegments)];
    }
    case 'thinking': {
      const label = item.seconds ? `Suy nghĩ ${item.seconds}s` : 'Đang suy nghĩ';
      // Sau khi xong, khối thinking thu gọn thành một dòng; bấm phím hoặc click để mở lại.
      if (item.expanded === false) {
        const left = paintSegments([
          { text: `  ${GLYPHS.expand} ${GLYPHS.thinking} ${label}`, color: COLORS.muted, dim: true },
        ]);
        const hint = paintSegments([{ text: 'click để mở', color: COLORS.muted, dim: true }]);
        if (width >= visibleWidth(left) + visibleWidth(hint) + 3) {
          return ['', padBetween(left, hint, width, 2)];
        }
        return ['', left];
      }
      // Nội dung thinking là markdown nên render đầy đủ, chỉ giữ style mờ.
      const tail = item.text.split('\n').slice(-THINKING_MAX_LINES).join('\n');
      const lines = renderMarkdown(tail, width - 4);
      return [
        '',
        paintSegments([{ text: `  ${GLYPHS.collapse} ${GLYPHS.thinking} ${label}`, color: COLORS.muted, dim: true, italic: true }]),
        ...lines.map((line) =>
          paintSegments([
            { text: `  ${GLYPHS.rail} `, color: COLORS.border, dim: true },
            ...line.map((segment) => ({ ...segment, dim: true })),
          ]),
        ),
      ];
    }
    case 'info':
      return [
        '',
        ...renderStyledText(item.text, width - 4, { dim: true }).map((line) =>
          paintSegments([{ text: `  ${GLYPHS.bullet} `, color: COLORS.accent, dim: true }, ...line]),
        ),
      ];
    case 'error':
      return [
        '',
        ...renderStyledText(item.text, width - 4, { color: COLORS.danger }).map((line, index) =>
          paintSegments([{ text: index === 0 ? `  ${GLYPHS.error} ` : '    ', color: COLORS.danger }, ...line]),
        ),
      ];
    case 'tool':
      return toolLines(item, width);
  }
}
