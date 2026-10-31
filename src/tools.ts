// Bộ tool cho agent: đọc/ghi/sửa file, chạy lệnh, grep và glob.
import { execFile } from 'node:child_process';
import { glob, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ToolResult, ToolSpec } from './types.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 30_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'target', 'vendor']);

// Cắt output dài để không làm ngập context của model.
function clip(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n...[đã cắt bớt]` : text;
}

// Chuẩn hoá đường dẫn tương đối theo thư mục làm việc.
function resolvePath(cwd: string, input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Thiếu tham số "path".');
  return path.resolve(cwd, input);
}

// Đọc file kèm số dòng, hỗ trợ offset và limit.
async function readFileTool(cwd: string, args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = resolvePath(cwd, args.path);
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Math.max(1, Number(args.limit) || 2000);
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = selected.map((line, index) => `${offset + index}\t${line}`).join('\n');
  const suffix = offset - 1 + limit < lines.length ? `\n...[còn ${lines.length - offset - limit + 1} dòng]` : '';
  return { content: clip(numbered + suffix) };
}

// Ghi đè toàn bộ nội dung file, tạo thư mục cha nếu cần.
async function writeFileTool(cwd: string, args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = resolvePath(cwd, args.path);
  if (typeof args.content !== 'string') throw new Error('Thiếu tham số "content".');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, args.content, 'utf8');
  return { content: `Đã ghi ${filePath} (${args.content.length} ký tự).` };
}

// Thay thế chuỗi chính xác trong file, lỗi nếu không khớp hoặc khớp nhiều lần.
async function editFileTool(cwd: string, args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = resolvePath(cwd, args.path);
  const oldString = args.old_string;
  const newString = args.new_string;
  if (typeof oldString !== 'string' || !oldString) throw new Error('Thiếu tham số "old_string".');
  if (typeof newString !== 'string') throw new Error('Thiếu tham số "new_string".');
  const content = await readFile(filePath, 'utf8');
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) throw new Error('Không tìm thấy "old_string" trong file.');
  if (occurrences > 1 && !args.replace_all) {
    throw new Error(`"old_string" xuất hiện ${occurrences} lần; thêm replace_all=true hoặc chuỗi cụ thể hơn.`);
  }
  // Dùng hàm thay thế thay vì chuỗi: chuỗi bị hiểu là mẫu, nên new_string chứa $& hay $1 sẽ bị biến đổi.
  const updated = args.replace_all ? content.split(oldString).join(newString) : content.replace(oldString, () => newString);
  await writeFile(filePath, updated, 'utf8');
  return { content: `Đã sửa ${filePath} (${occurrences} chỗ).` };
}

// Xác định shell và tham số chạy lệnh theo hệ điều hành.
export function resolveShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  // Windows không có /bin/sh, dùng cmd.exe của hệ thống.
  if (platform === 'win32') return { command: env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c'] };
  return { command: '/bin/sh', args: ['-c'] };
}

// Môi trường cho tiến trình con, bổ sung thư mục tạm khi môi trường cha chưa đặt.
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const dir = tmpdir();
  return { ...base, TMPDIR: base.TMPDIR || dir, TMP: base.TMP || dir, TEMP: base.TEMP || dir };
}

// Chạy lệnh shell trong thư mục làm việc, trả stdout và stderr.
async function bashTool(cwd: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
  if (typeof args.command !== 'string' || !args.command.trim()) throw new Error('Thiếu tham số "command".');
  const timeout = Math.min(Math.max(Number(args.timeout) || 120, 1), 600) * 1000;
  const shell = resolveShell();
  try {
    const { stdout, stderr } = await execFileAsync(shell.command, [...shell.args, args.command], {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      signal,
      env: childEnv(),
    });
    return {
      content: clip([stdout, stderr].filter(Boolean).join('\n') || '(không có output)'),
      meta: { exitCode: 0 },
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string; code?: number | string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
    return {
      content: clip(output || err.message),
      isError: true,
      meta: typeof err.code === 'number' ? { exitCode: err.code } : undefined,
    };
  }
}

// Tìm file theo glob, bỏ qua thư mục nặng và giới hạn số kết quả.
async function globTool(cwd: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (typeof args.pattern !== 'string' || !args.pattern.trim()) throw new Error('Thiếu tham số "pattern".');
  const matches: string[] = [];
  for await (const entry of glob(args.pattern, { cwd })) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.split('/').some((part) => SKIP_DIRS.has(part))) continue;
    matches.push(normalized);
    if (matches.length >= 200) break;
  }
  matches.sort();
  return { content: matches.length ? matches.join('\n') : 'Không tìm thấy file phù hợp.' };
}

// Quét nội dung file bằng regex, ưu tiên ripgrep nếu có sẵn.
async function grepTool(cwd: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (typeof args.pattern !== 'string' || !args.pattern) throw new Error('Thiếu tham số "pattern".');
  const target = typeof args.path === 'string' && args.path ? args.path : '.';
  const include = typeof args.glob === 'string' && args.glob ? ['-g', args.glob] : [];
  try {
    const { stdout } = await execFileAsync('rg', ['--line-number', '--no-heading', '--color', 'never', ...include, '-e', args.pattern, target], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { content: clip(stdout || 'Không có kết quả.') };
  } catch (error) {
    const err = error as { code?: string; stdout?: string; stderr?: string; message: string };
    if (err.code === 'ENOENT') return grepFallback(cwd, args);
    if (err.stdout) return { content: clip(err.stdout) };
    if (err.code === '1') return { content: 'Không có kết quả.' };
    return { content: clip(err.stderr || err.message), isError: true };
  }
}

// Fallback thuần Node khi máy không có ripgrep.
export async function grepFallback(cwd: string, args: Record<string, unknown>): Promise<ToolResult> {
  let pattern: RegExp;
  try {
    pattern = new RegExp(String(args.pattern), 'i');
  } catch (error) {
    // Regex hợp lệ với ripgrep có thể không hợp lệ với JS; báo lỗi thay vì ném để agent đọc được.
    return { content: error instanceof Error ? error.message : String(error), isError: true };
  }
  const root = path.resolve(cwd, typeof args.path === 'string' && args.path ? args.path : '.');
  const results: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (results.length >= 200) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const content = await readFile(full, 'utf8');
          content.split('\n').forEach((line, index) => {
            if (pattern.test(line) && results.length < 200) {
              results.push(`${path.relative(cwd, full)}:${index + 1}:${line}`);
            }
          });
        } catch {
          // Bỏ qua file nhị phân hoặc không đọc được.
        }
      }
    }
  };
  await walk(root);
  return { content: results.length ? clip(results.join('\n')) : 'Không có kết quả.' };
}

// Tạo danh sách tool kèm schema tham số.
export function createTools(cwd: string): ToolSpec[] {
  return [
    {
      name: 'read_file',
      description: 'Đọc file kèm số dòng. Dùng offset/limit cho file dài.',
      needsApproval: false,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Đường dẫn file' },
          offset: { type: 'number', description: 'Dòng bắt đầu (1-based)' },
          limit: { type: 'number', description: 'Số dòng tối đa' },
        },
        required: ['path'],
      },
      run: (args) => readFileTool(cwd, args),
    },
    {
      name: 'write_file',
      description: 'Ghi đè toàn bộ nội dung file, tạo thư mục cha nếu cần.',
      needsApproval: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Đường dẫn file' },
          content: { type: 'string', description: 'Nội dung đầy đủ' },
        },
        required: ['path', 'content'],
      },
      run: (args) => writeFileTool(cwd, args),
    },
    {
      name: 'edit_file',
      description: 'Thay thế chuỗi chính xác trong file; dùng replace_all khi muốn thay mọi chỗ.',
      needsApproval: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Đường dẫn file' },
          old_string: { type: 'string', description: 'Chuỗi cần thay' },
          new_string: { type: 'string', description: 'Chuỗi thay thế' },
          replace_all: { type: 'boolean', description: 'Thay tất cả lần xuất hiện' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
      run: (args) => editFileTool(cwd, args),
    },
    {
      name: 'bash',
      description: 'Chạy lệnh shell trong thư mục làm việc. Timeout mặc định 120 giây.',
      needsApproval: true,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Lệnh cần chạy' },
          timeout: { type: 'number', description: 'Timeout tính bằng giây' },
        },
        required: ['command'],
      },
      run: (args, signal) => bashTool(cwd, args, signal),
    },
    {
      name: 'grep',
      description: 'Tìm nội dung theo regex trong file, trả về đường dẫn và số dòng.',
      needsApproval: false,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex cần tìm' },
          path: { type: 'string', description: 'Thư mục hoặc file cần quét' },
          glob: { type: 'string', description: 'Lọc file theo glob, ví dụ *.ts' },
        },
        required: ['pattern'],
      },
      run: (args) => grepTool(cwd, args),
    },
    {
      name: 'glob',
      description: 'Liệt kê file khớp pattern, ví dụ **/*.ts.',
      needsApproval: false,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern' },
        },
        required: ['pattern'],
      },
      run: (args) => globTool(cwd, args),
    },
  ];
}
