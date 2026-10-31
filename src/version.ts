// Phiên bản lấy từ package.json để chỉ có một nguồn, tránh lệch với gói đã phát hành.
import { readFileSync } from 'node:fs';

// Đọc package.json ở gốc repo; sau khi build, file gọi nằm ở dist/src nên lên hai cấp.
export function readVersion(): string {
  try {
    const file = new URL('../../package.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();
