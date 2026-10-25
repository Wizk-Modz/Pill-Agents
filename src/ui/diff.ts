// So sánh hai đoạn văn bản theo dòng bằng LCS, phục vụ thẻ tool và hộp duyệt.
export type DiffKind = 'context' | 'add' | 'remove';

export type DiffLine = {
  kind: DiffKind;
  text: string;
};

export type DiffResult = {
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
};

export const DIFF_MAX_LINES = 1000;

// So sánh từng dòng của hai chuỗi, giới hạn số dòng để tránh tốn bộ nhớ.
export function diffLines(before: string, after: string, limit = DIFF_MAX_LINES): DiffResult {
  const beforeAll = before.split('\n');
  const afterAll = after.split('\n');
  const truncated = beforeAll.length > limit || afterAll.length > limit;
  const left = beforeAll.slice(0, limit);
  const right = afterAll.slice(0, limit);
  const rows = left.length;
  const columns = right.length;
  const width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);

  // Điền bảng LCS từ góc dưới bên phải để truy vết xuôi theo chiều dài.
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const index = row * width + column;
      if (left[row] === right[column]) {
        table[index] = table[(row + 1) * width + column + 1]! + 1;
      } else {
        table[index] = Math.max(table[(row + 1) * width + column]!, table[row * width + column + 1]!);
      }
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (left[row] === right[column]) {
      lines.push({ kind: 'context', text: left[row]! });
      row += 1;
      column += 1;
      continue;
    }
    if (table[(row + 1) * width + column]! >= table[row * width + column + 1]!) {
      lines.push({ kind: 'remove', text: left[row]! });
      removed += 1;
      row += 1;
    } else {
      lines.push({ kind: 'add', text: right[column]! });
      added += 1;
      column += 1;
    }
  }
  while (row < rows) {
    lines.push({ kind: 'remove', text: left[row]! });
    removed += 1;
    row += 1;
  }
  while (column < columns) {
    lines.push({ kind: 'add', text: right[column]! });
    added += 1;
    column += 1;
  }

  if (truncated) lines.push({ kind: 'context', text: `… chỉ so sánh ${limit} dòng đầu` });
  return { lines, added, removed, truncated };
}
