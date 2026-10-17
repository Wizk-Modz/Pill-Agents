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

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
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
