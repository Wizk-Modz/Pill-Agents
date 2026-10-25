// Xác định dòng transcript nằm dưới con trỏ chuột để mở/đóng đúng mục.
import type { TranscriptItem } from './Transcript.js';

export type LineOwner = {
  id: number;
  kind: TranscriptItem['kind'];
  header: boolean;
};

// Đổi tọa độ chuột 1-based thành chỉ số dòng tuyệt đối trong transcript.
export function hitTestLine(
  owners: readonly LineOwner[],
  options: { top: number; transcriptTop: number; row: number; height?: number },
): LineOwner | undefined {
  const localRow = options.row - 1 - options.transcriptTop;
  if (localRow < 0) return undefined;
  if (options.height !== undefined && localRow >= options.height) return undefined;
  return owners[options.top + localRow];
}

// Kiểm tra cột chuột có nằm trong vùng transcript hay không.
export function hitTestColumn(column: number, left: number, width: number): boolean {
  const localColumn = column - 1;
  return localColumn >= left && localColumn < left + width;
}
