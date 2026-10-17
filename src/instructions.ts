// Nạp file hướng dẫn PILL.md: bản global trong thư mục cấu hình và bản project theo cây thư mục.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type InstructionFile = {
  path: string;
  label: string;
  content: string;
};

// Đọc một file, trả null nếu không tồn tại hoặc rỗng.
function readIfExists(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    return content || null;
  } catch {
    return null;
  }
}

// Liệt kê các thư mục từ gốc hệ thống xuống thư mục làm việc.
function ancestorDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(cwd);
  while (true) {
    dirs.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

// Thu thập PILL.md global và PILL.md ở các thư mục cha của thư mục làm việc.
export function loadInstructions(cwd: string, configDir: string): InstructionFile[] {
  const files: InstructionFile[] = [];

  const global = readIfExists(path.join(configDir, 'PILL.md'));
  if (global) {
    files.push({ path: path.join(configDir, 'PILL.md'), label: 'hướng dẫn chung của người dùng cho mọi dự án', content: global });
  }

  for (const dir of ancestorDirs(cwd)) {
    const filePath = path.join(dir, 'PILL.md');
    const content = readIfExists(filePath);
    if (content) {
      files.push({ path: filePath, label: 'hướng dẫn của dự án', content });
    }
  }

  return files;
}

// Ghép các file hướng dẫn thành khối text để chèn vào system prompt.
export function renderInstructions(files: InstructionFile[]): string {
  if (!files.length) return '';
  const sections = files.map((file) => `Contents of ${file.path} (${file.label}):\n\n${file.content}`);
  return [
    'Hướng dẫn của người dùng và dự án được nêu dưới đây. Tuân thủ nghiêm ngặt.',
    'QUAN TRỌNG: những hướng dẫn này GHI ĐÈ hành vi mặc định, phải làm đúng như đã viết.',
    '',
    ...sections,
  ].join('\n');
}
