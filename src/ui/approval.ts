// Dựng nội dung hộp duyệt tool: lệnh, diff hoặc bản xem trước file.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ToolCall } from '../types.js';
import { diffLines, type DiffResult } from './diff.js';
import { fitText } from './format.js';
import { paintSegments, wrapSegments, type Segment } from './markdown.js';

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s*)+/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b[^;\n]*-[a-zA-Z]*f/,
  /\bgit\s+checkout\s+--\s/,
  /\bgit\s+restore\b[^;\n]*--source/,
  /\bmkfs(?:\.\w+)?\b/,
  /\bdd\s+if=/,
  /\bchmod\s+-R\s+777\s+\//,
  /\b(?:shutdown|reboot)\b/,
  /\bfind\b[^;\n]*-delete\b/,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:/,
];

// Phát hiện lệnh shell có khả năng xoá hoặc ghi đè dữ liệu.
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

// Phân tích tham số tool để hiển thị, trả object rỗng nếu JSON lỗi.
function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Wrap nội dung thành các dòng ANSI có tiền tố, giới hạn số dòng.
function textPreview(
  text: string,
  width: number,
  prefix: string,
  style: Omit<Segment, 'text'>,
  maxLines: number,
): string[] {
  const source = text.split('\n');
  const bodyWidth = Math.max(10, width - [...prefix].length);
  const output: string[] = [];
  let hidden = 0;
  for (let index = 0; index < source.length; index += 1) {
    const wrapped = wrapSegments([{ ...style, text: source[index] || ' ' }], bodyWidth);
    if (output.length + wrapped.length > maxLines) {
      hidden = source.length - index;
      break;
    }
    for (const segments of wrapped) {
      output.push(paintSegments([{ text: prefix, dim: true }, ...segments]));
    }
  }
  if (hidden > 0) {
    output.splice(Math.max(0, maxLines - 1));
    output.push(paintSegments([{ text: fitText(`  … +${hidden} dòng`, width), color: 'gray', dim: true }]));
  }
  return output.slice(0, maxLines);
}

// Render các dòng diff kèm dấu, màu và giới hạn số dòng.
function diffPreview(diff: DiffResult, width: number, maxLines: number): string[] {
  const shown = diff.lines.slice(0, maxLines);
  const output = shown.map((line) => {
    const marker = line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  ';
    const color = line.kind === 'add' ? 'green' : line.kind === 'remove' ? 'red' : undefined;
    return paintSegments([
      { text: '  ', dim: true },
      { text: marker, color },
      { text: fitText(line.text, Math.max(10, width - 5)), color, dim: line.kind === 'context' },
    ]);
  });
  const hidden = diff.lines.length - shown.length;
  if (hidden > 0) {
    output.splice(Math.max(0, maxLines - 1));
    output.push(paintSegments([{ text: `  … +${hidden} dòng`, color: 'gray', dim: true }]));
  }
  return output.slice(0, maxLines);
}

// Render diff của edit_file từ hai chuỗi tham số.
function editDiff(args: Record<string, unknown>): DiffResult | undefined {
  if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') return undefined;
  return diffLines(args.old_string, args.new_string, 400);
}

// Dựng toàn bộ dòng ANSI cho hộp duyệt, chiều cao khớp với số dòng trả về.
export function buildApprovalLines(
  call: ToolCall,
  options: { width: number; expanded: boolean; cwd: string; maxPreview?: number },
): string[] {
  const width = Math.max(20, options.width);
  const maxPreview = Math.max(1, options.maxPreview ?? (options.expanded ? 24 : 6));
  const args = parseArgs(call);
  const lines: string[] = [];

  lines.push(
    paintSegments([
      { text: '⏵ ', color: 'yellow', bold: true },
      { text: 'Cho phép chạy ', color: 'yellow', bold: true },
      { text: call.name, bold: true },
    ]),
  );

  if (call.name === 'bash') {
    const timeout = Math.min(Math.max(Number(args.timeout) || 120, 1), 600);
    lines.push(paintSegments([{ text: `  timeout ${timeout}s`, dim: true }]));
    const command = typeof args.command === 'string' ? args.command : '';
    if (isDangerousCommand(command)) {
      lines.push(
        paintSegments([
          { text: fitText('  ⚠ Lệnh có thể phá huỷ dữ liệu — kiểm tra kỹ trước khi đồng ý.', width), color: 'red', bold: true },
        ]),
      );
    }
    lines.push(...textPreview(command, width, '  $ ', { color: 'white' }, maxPreview));
  } else if (call.name === 'edit_file') {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const diff = editDiff(args);
    const stats = diff ? ` · +${diff.added} −${diff.removed}` : '';
    lines.push(
      paintSegments([
        { text: `  ${fitText(filePath, Math.max(10, width - 14 - stats.length))}`, dim: true },
        ...(diff
          ? [
              { text: ' · ', dim: true },
              { text: `+${diff.added}`, color: 'green' as const },
              { text: ' ', dim: true },
              { text: `−${diff.removed}`, color: 'red' as const },
            ]
          : []),
        ...(args.replace_all ? [{ text: ' · thay tất cả', color: 'yellow' as const }] : []),
      ]),
    );
    if (diff) {
      lines.push(...diffPreview(diff, width, maxPreview));
    } else {
      lines.push(paintSegments([{ text: '  (thiếu old_string hoặc new_string)', color: 'red' }]));
    }
  } else if (call.name === 'write_file') {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const lineCount = content ? content.split('\n').length : 0;
    lines.push(
      paintSegments([
        { text: `  ${fitText(filePath, Math.max(10, width - 24))}`, dim: true },
        { text: ` · ${lineCount} dòng · ${content.length} ký tự`, dim: true },
      ]),
    );
    const target = filePath ? path.resolve(options.cwd, filePath) : '';
    if (target && existsSync(target)) {
      lines.push(
        paintSegments([
          { text: fitText('  ⚠ File đã tồn tại — nội dung cũ sẽ bị ghi đè.', width), color: 'yellow', bold: true },
        ]),
      );
    }
    lines.push(...textPreview(content, width, '  │ ', {}, maxPreview));
  } else {
    lines.push(paintSegments([{ text: `  ${fitText(call.arguments, Math.max(10, width - 2))}`, dim: true }]));
  }

  lines.push(
    paintSegments([
      { text: '  [y]', color: 'green' },
      { text: ' đồng ý   ' },
      { text: '[n/Esc]', color: 'red' },
      { text: ' từ chối   ' },
      { text: '[d]', color: 'cyan' },
      { text: options.expanded ? ' thu gọn' : ' xem đầy đủ' },
    ]),
  );
  return lines;
}
