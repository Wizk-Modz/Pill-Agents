// Định dạng số liệu hiển thị: token, thời gian, đường dẫn và khung spinner.
import path from 'node:path';

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// Khung hình spinner braille, gồm cả U+283C (BRAILLE PATTERN DOTS-346).
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Rút gọn số token: 1234 thành 1.2k.
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1)}k`;
}

// Rút gọn thời gian chạy tool: dưới 1 giây dùng ms, trên 1 phút dùng phút giây.
export function formatDuration(milliseconds: number): string {
  const value = Math.max(0, Math.round(milliseconds));
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(value / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
}

// Rút gọn thời gian của lượt đang chạy, chỉ hiện giây hoặc phút.
export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
}

// Thay thư mục nhà bằng ~ để header gọn hơn.
export function shortenCwd(cwd: string, home: string): string {
  const relative = path.relative(home, cwd);
  if (!relative) return '~';
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return `~${path.sep}${relative}`;
  return cwd;
}

// Cắt chuỗi theo code point cho vừa độ rộng, thêm dấu … nếu bị cắt.
export function fitText(text: string, width: number): string {
  const chars = [...text];
  if (chars.length <= width) return text;
  if (width <= 1) return '…';
  return `${chars.slice(0, width - 1).join('')}…`;
}

// Đếm ký tự hiển thị sau khi bỏ mã màu ANSI.
export function visibleWidth(text: string): number {
  return [...text.replace(ANSI_PATTERN, '')].length;
}

// Ghép hai chuỗi và đệm khoảng trắng để chuỗi phải sát lề phải.
export function padBetween(left: string, right: string, width: number, minGap = 2): string {
  const gap = Math.max(minGap, width - visibleWidth(left) - visibleWidth(right));
  return `${left}${' '.repeat(gap)}${right}`;
}
