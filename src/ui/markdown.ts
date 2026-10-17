// Render markdown thành chuỗi ANSI: mỗi dòng một chuỗi, ít node nên TUI mượt hơn.
export type Segment = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

const CODES: Record<string, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  grey: 90,
};

// Bọc một segment bằng mã ANSI tương ứng.
export function paint(segment: Segment): string {
  const codes: number[] = [];
  if (segment.bold) codes.push(1);
  if (segment.dim) codes.push(2);
  if (segment.italic) codes.push(3);
  if (segment.underline) codes.push(4);
  const color = segment.color ? CODES[segment.color] : undefined;
  if (color) codes.push(color);
  if (!codes.length) return segment.text;
  return `\x1b[${codes.join(';')}m${segment.text}\x1b[0m`;
}

// Ghép nhiều segment thành một chuỗi ANSI.
export function paintSegments(segments: Segment[]): string {
  return segments.map(paint).join('');
}

// Phân tích cú pháp inline: bold, italic, code, link.
function inlineSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index) });
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      segments.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith('`')) {
      segments.push({ text: token.slice(1, -1), color: 'yellow' });
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      segments.push({ text: link?.[1] ?? token, color: 'cyan', underline: true });
    } else {
      segments.push({ text: token.slice(1, -1), italic: true });
    }
    last = index + token.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.filter((segment) => segment.text.length > 0);
}

// Đo độ rộng hiển thị của chuỗi theo số code point.
function displayWidth(text: string): number {
  // ponytail: đếm theo code point; ký tự CJK rộng gấp đôi sẽ lệch, dùng string-width nếu cần
  return [...text].length;
}

// Đo độ rộng hiển thị của một danh sách segment.
function segmentsWidth(segments: Segment[]): number {
  return segments.reduce((total, segment) => total + displayWidth(segment.text), 0);
}

// Cắt segment cho vừa độ rộng, thêm dấu … nếu bị cắt.
function clipSegments(segments: Segment[], max: number): Segment[] {
  const output: Segment[] = [];
  let used = 0;
  for (const segment of segments) {
    const chars = [...segment.text];
    if (used + chars.length <= max) {
      output.push(segment);
      used += chars.length;
      continue;
    }
    const room = max - used - 1;
    if (room > 0) output.push({ ...segment, text: chars.slice(0, room).join('') });
    output.push({ text: '…' });
    return output;
  }
  return output;
}

// Căn lề của một cột trong bảng.
type Align = 'left' | 'center' | 'right';

// Tách một dòng bảng thành các ô, bỏ dấu | ở hai đầu.
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

// Kiểm tra dòng phân cách giữa header và thân bảng.
function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

// Đọc căn lề từng cột từ dòng phân cách.
function parseAligns(line: string): Align[] {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

// Thêm khoảng trắng đệm để ô đủ độ rộng theo căn lề.
function padCell(segments: Segment[], width: number, align: Align): Segment[] {
  const space = Math.max(0, width - segmentsWidth(segments));
  if (align === 'right') return [{ text: ' '.repeat(space) }, ...segments];
  if (align === 'center') {
    const left = Math.floor(space / 2);
    return [{ text: ' '.repeat(left) }, ...segments, { text: ' '.repeat(space - left) }];
  }
  return [...segments, { text: ' '.repeat(space) }];
}

const TABLE_MIN_COL = 6;

// Tính độ rộng từng cột, thu hẹp dần nếu bảng vượt quá độ rộng cho phép.
function columnWidths(natural: number[], available: number): number[] {
  const widths = natural.map((value) => Math.max(TABLE_MIN_COL, value));
  // Mỗi cột tốn thêm 3 ký tự cho "│ " và " ", cộng 1 cho viền phải.
  const overhead = 3 * widths.length + 1;
  const budget = Math.max(TABLE_MIN_COL, available - overhead);
  let total = widths.reduce((sum, value) => sum + value, 0);
  while (total > budget) {
    let widest = 0;
    for (let index = 1; index < widths.length; index++) {
      if (widths[index]! > widths[widest]!) widest = index;
    }
    if (widths[widest]! <= TABLE_MIN_COL) break;
    widths[widest]! -= 1;
    total -= 1;
  }
  return widths;
}

// Render bảng markdown thành khung box-drawing.
function renderTable(header: string[], aligns: Align[], rows: string[][], width: number): Segment[][] {
  const columns = header.length;
  if (!columns) return [];

  const headerCells = header.map(inlineSegments);
  const bodyCells = rows.map((row) =>
    Array.from({ length: columns }, (_, index) => inlineSegments(row[index] ?? '')),
  );

  const natural = Array.from({ length: columns }, (_, index) =>
    Math.max(
      segmentsWidth(headerCells[index]!),
      ...bodyCells.map((row) => segmentsWidth(row[index]!)),
    ),
  );
  const widths = columnWidths(natural, width);

  // Tạo đường kẻ ngang với các nút giao tương ứng.
  const rule = (left: string, middle: string, right: string): Segment[] => [
    { text: left + widths.map((value) => '─'.repeat(value + 2)).join(middle) + right, color: 'gray' },
  ];

  // Ghép một hàng thành các segment có viền dọc.
  const buildRow = (cells: Segment[][]): Segment[] => {
    const output: Segment[] = [{ text: '│', color: 'gray' }];
    for (let index = 0; index < columns; index++) {
      output.push({ text: ' ' });
      output.push(...padCell(clipSegments(cells[index]!, widths[index]!), widths[index]!, aligns[index] ?? 'left'));
      output.push({ text: ' ' });
      output.push({ text: '│', color: 'gray' });
    }
    return output;
  };

  const output: Segment[][] = [rule('┌', '┬', '┐')];
  output.push(buildRow(headerCells.map((cell) => cell.map((segment) => ({ ...segment, bold: true })))));
  output.push(rule('├', '┼', '┤'));
  for (const row of bodyCells) output.push(buildRow(row));
  output.push(rule('└', '┴', '┘'));
  return output;
}

// Tách segment thành token giữ khoảng trắng để wrap theo từ.
function tokenize(segments: Segment[]): Segment[] {
  const tokens: Segment[] = [];
  for (const segment of segments) {
    for (const part of segment.text.split(/(\s+)/)) {
      if (part) tokens.push({ ...segment, text: part });
    }
  }
  return tokens;
}

// Wrap danh sách segment theo độ rộng, giữ nguyên style từng phần.
export function wrapSegments(segments: Segment[], width: number): Segment[][] {
  const limit = Math.max(10, width);
  const lines: Segment[][] = [];
  let current: Segment[] = [];
  let length = 0;

  // Kết thúc dòng hiện tại, bỏ khoảng trắng cuối.
  const pushLine = (): void => {
    const last = current[current.length - 1];
    if (last && /^\s+$/.test(last.text)) current.pop();
    lines.push(current.length ? current : [{ text: '' }]);
    current = [];
    length = 0;
  };

  for (const token of tokenize(segments)) {
    if (/^\s+$/.test(token.text) && current.length === 0) continue;
    if (length + token.text.length > limit && current.length > 0) pushLine();
    let text = token.text;
    while (text.length > limit) {
      const chunk = text.slice(0, limit);
      current.push({ ...token, text: chunk });
      length += chunk.length;
      text = text.slice(limit);
      pushLine();
    }
    if (text) {
      current.push({ ...token, text });
      length += text.length;
    }
  }
  if (current.length) pushLine();
  return lines;
}

// Render text nhiều dòng với một style duy nhất.
export function renderStyledText(text: string, width: number, style: Omit<Segment, 'text'>): Segment[][] {
  const output: Segment[][] = [];
  for (const line of text.split('\n')) {
    if (!line) {
      output.push([{ text: '' }]);
      continue;
    }
    output.push(...wrapSegments([{ ...style, text: line }], width));
  }
  return output;
}

// Render markdown (heading, list, quote, code fence, inline) thành các dòng segment.
export function renderMarkdown(text: string, width: number): Segment[][] {
  const output: Segment[][] = [];
  let inCode = false;
  let codeLines: string[] = [];

  // Đẩy các dòng code đã gom vào output.
  const flushCode = (): void => {
    for (const line of codeLines) {
      output.push([{ text: '│ ', color: 'gray', dim: true }, { text: line, color: 'green' }]);
    }
    codeLines = [];
  };

  const raw = text.split('\n');

  for (let index = 0; index < raw.length; index++) {
    const line = (raw[index] ?? '').replace(/\t/g, '  ');

    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Bảng: dòng tiêu đề chứa |, dòng kế tiếp là dòng phân cách.
    const next = raw[index + 1];
    if (line.includes('|') && next && isSeparatorRow(next)) {
      const header = splitRow(line);
      const aligns = parseAligns(next);
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < raw.length) {
        const rowLine = raw[cursor] ?? '';
        if (!rowLine.includes('|') || !rowLine.trim()) break;
        rows.push(splitRow(rowLine));
        cursor++;
      }
      output.push(...renderTable(header, aligns, rows, width));
      index = cursor - 1;
      continue;
    }

    if (!line.trim()) {
      output.push([{ text: '' }]);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      output.push(...wrapSegments([{ text: heading[2] ?? '', bold: true, color: 'cyan' }], width));
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      output.push([{ text: '─'.repeat(Math.max(4, width)), dim: true }]);
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      for (const wrapped of wrapSegments(inlineSegments(quote[1] ?? ''), width - 2)) {
        output.push([{ text: '│ ', color: 'gray' }, ...wrapped]);
      }
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const indent = ' '.repeat(Math.min((bullet[1] ?? '').length, 8));
      const inner = wrapSegments(inlineSegments(bullet[2] ?? ''), width - indent.length - 2);
      inner.forEach((wrapped, index) => {
        output.push([{ text: index === 0 ? `${indent}• ` : `${indent}  `, color: 'cyan' }, ...wrapped]);
      });
      continue;
    }

    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      const indent = ' '.repeat(Math.min((numbered[1] ?? '').length, 8));
      const marker = `${numbered[2]}. `;
      const inner = wrapSegments(inlineSegments(numbered[3] ?? ''), width - indent.length - marker.length);
      inner.forEach((wrapped, index) => {
        output.push([
          { text: index === 0 ? `${indent}${marker}` : `${indent}${' '.repeat(marker.length)}`, color: 'cyan' },
          ...wrapped,
        ]);
      });
      continue;
    }

    output.push(...wrapSegments(inlineSegments(line), width));
  }
  if (inCode) flushCode();
  return output;
}
