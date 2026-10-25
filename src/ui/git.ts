// Đọc tên nhánh git hiện tại để hiển thị trên header, lỗi thì bỏ qua.
import { execFileSync } from 'node:child_process';

export function readGitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch && branch !== 'HEAD' ? branch : undefined;
  } catch {
    return undefined;
  }
}
