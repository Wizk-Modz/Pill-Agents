// Bộ tool cho agent: đọc/ghi/sửa file, chạy lệnh, grep và glob.
// Tên tool và tham số theo quy ước của Claude Code: Read, Write, Edit, Glob dùng "file_path" tuyệt đối.
import { execFile } from 'node:child_process';
import { glob, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ToolResult, ToolSpec } from './types.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 30_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'target', 'vendor']);
// Thư mục hệ thống không bao giờ chứa mã nguồn nhưng lại rất nặng khi quét từ gốc.
const SKIP_SYSTEM_DIRS = new Set(['proc', 'sys', 'dev', 'run', 'snap', 'boot', 'lost+found']);
// Read đọc tối đa 2000 dòng mỗi lần và cắt dòng dài hơn 2000 ký tự, giống Claude Code.
const READ_MAX_LINES = 2000;
const READ_MAX_LINE_CHARS = 2000;
const GLOB_SCAN_LIMIT = 2000;
const GLOB_MAX_RESULTS = 200;
// Trần thời gian cho tool quét: thư mục lớn như /root hay ổ mạng có thể mất hàng phút,
// mà model không cần chờ. Hết giờ thì trả kết quả một phần kèm ghi chú.
const SCAN_TIMEOUT_MS = 10_000;

// Trạng thái dùng chung giữa các tool trong một phiên: file đã đọc để chặn ghi đè mù.
export type ToolState = {
  readFiles: Set<string>;
};

// Tạo trạng thái rỗng cho một phiên làm việc.
export function createToolState(): ToolState {
  return { readFiles: new Set() };
}

// Cắt output dài để không làm ngập context của model.
function clip(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n...[đã cắt bớt]` : text;
}

// Chuẩn hoá đường dẫn tuyệt đối; từ chối đường dẫn tương đối để model không đoán sai thư mục.
function requireAbsolutePath(input: unknown, name = 'file_path'): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`Thiếu tham số "${name}".`);
  if (!path.isAbsolute(input)) {
    throw new Error(`"${name}" phải là đường dẫn tuyệt đối; nhận được "${input}".`);
  }
  return path.resolve(input);
}

// Lấy thông tin file, trả undefined nếu không tồn tại.
async function statIfExists(filePath: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
  }
}

// Đọc file kèm số dòng theo dạng cat -n, hỗ trợ offset và limit.
async function readTool(
  cwd: string,
  args: Record<string, unknown>,
  state: ToolState,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const filePath = requireAbsolutePath(args.file_path);
  const info = await statIfExists(filePath);
  if (info?.isDirectory()) throw new Error(`"${filePath}" là thư mục; Read chỉ đọc được file.`);
  const content = await readFile(filePath, 'utf8');
  if (signal?.aborted) throw new Error('Đã huỷ bởi người dùng.');
  state.readFiles.add(filePath);

  if (!content) return { content: '(file rỗng)' };

  const lines = content.split('\n');
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Math.max(1, Number(args.limit) || READ_MAX_LINES);
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = selected.map((line, index) => {
    // Dòng quá dài bị cắt để một file minified không chiếm hết context.
    const shown =
      line.length > READ_MAX_LINE_CHARS ? `${line.slice(0, READ_MAX_LINE_CHARS)}… [dòng bị cắt]` : line;
    return `${String(offset + index).padStart(6, ' ')}\t${shown}`;
  });
  const shownTo = offset - 1 + selected.length;
  const suffix = shownTo < lines.length ? `\n...[còn ${lines.length - shownTo} dòng]` : '';
  return { content: clip(numbered.join('\n') + suffix) };
}

// Ghi đè toàn bộ nội dung file, tạo thư mục cha nếu cần.
async function writeTool(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const filePath = requireAbsolutePath(args.file_path);
  if (typeof args.content !== 'string') throw new Error('Thiếu tham số "content".');
  const info = await statIfExists(filePath);
  if (info?.isDirectory()) throw new Error(`"${filePath}" là thư mục, không ghi đè được.`);
  // Ghi đè file đang có mà chưa đọc lần nào là cách chắc chắn nhất để mất nội dung.
  if (info && !state.readFiles.has(filePath)) {
    throw new Error(`Chưa đọc ${filePath} trong phiên này; dùng Read trước khi ghi đè.`);
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, args.content, 'utf8');
  state.readFiles.add(filePath);
  return { content: `Đã ghi ${filePath} (${args.content.length} ký tự).` };
}

// Thay thế chuỗi chính xác trong file, lỗi nếu không khớp hoặc khớp nhiều lần.
async function editTool(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const filePath = requireAbsolutePath(args.file_path);
  const oldString = args.old_string;
  const newString = args.new_string;
  if (typeof oldString !== 'string' || !oldString) throw new Error('Thiếu tham số "old_string".');
  if (typeof newString !== 'string') throw new Error('Thiếu tham số "new_string".');
  if (oldString === newString) throw new Error('"new_string" phải khác "old_string".');
  const content = await readFile(filePath, 'utf8');
  if (!state.readFiles.has(filePath)) {
    throw new Error(`Chưa đọc ${filePath} trong phiên này; dùng Read trước khi sửa.`);
  }
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

// Kiểm tra đường dẫn có nằm trong thư mục cần bỏ qua không.
function inSkippedDir(relative: string): boolean {
  return relative
    .replaceAll('\\', '/')
    .split('/')
    .some((part) => SKIP_DIRS.has(part) || SKIP_SYSTEM_DIRS.has(part));
}

// Tìm file theo glob, bỏ qua thư mục nặng, sắp theo thời gian sửa mới nhất.
async function globTool(
  cwd: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  if (typeof args.pattern !== 'string' || !args.pattern.trim()) throw new Error('Thiếu tham số "pattern".');
  const base = args.path === undefined ? cwd : requireAbsolutePath(args.path, 'path');
  const matches: string[] = [];
  let timedOut = false;
  // Trần thời gian tính cả lúc thư mục đích quá lớn; Esc của người dùng huỷ ngay qua signal.
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  // exclude giúp fs.glob không đi vào thư mục nặng; lọc lại ở đây để chắc chắn với
  // đường dẫn Windows và pattern lạ.
  for await (const entry of glob(args.pattern, { cwd: base, exclude: inSkippedDir })) {
    if (inSkippedDir(entry)) continue;
    matches.push(entry);
    if (signal.aborted) throw new Error('Đã huỷ bởi người dùng.');
    if (matches.length >= GLOB_SCAN_LIMIT) break;
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
  }
  if (!matches.length) {
    return { content: timedOut ? `Hết ${SCAN_TIMEOUT_MS / 1000}s mà chưa tìm thấy file phù hợp; thử "path" hẹp hơn.` : 'Không tìm thấy file phù hợp.' };
  }

  // Sắp theo mtime giảm dần để file vừa sửa hiện trước, giống Claude Code.
  const dated = await Promise.all(
    matches.map(async (relative) => {
      const full = path.join(base, relative);
      const info = await statIfExists(full);
      return { full, mtime: Number(info?.mtimeMs ?? 0) };
    }),
  );
  dated.sort((a, b) => b.mtime - a.mtime || a.full.localeCompare(b.full));
  const shown = dated.slice(0, GLOB_MAX_RESULTS).map((entry) => entry.full);
  const hidden = dated.length - shown.length;
  const notes: string[] = [];
  if (hidden > 0) notes.push(`còn ${hidden} file`);
  // Nói rõ kết quả chưa đầy đủ để model không kết luận thiếu file.
  if (timedOut) notes.push(`dừng sau ${SCAN_TIMEOUT_MS / 1000}s, chưa quét hết`);
  const suffix = notes.length ? `\n...[${notes.join('; ')}]` : '';
  return { content: clip(shown.join('\n') + suffix) };
}

// Quét nội dung file bằng regex, ưu tiên ripgrep nếu có sẵn.
async function grepTool(cwd: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
  if (typeof args.pattern !== 'string' || !args.pattern) throw new Error('Thiếu tham số "pattern".');
  const target = typeof args.path === 'string' && args.path ? args.path : '.';
  const include = typeof args.glob === 'string' && args.glob ? ['-g', args.glob] : [];
  // rg có sẵn --glob để bỏ thư mục nặng, nhưng vẫn cần signal để Esc dừng được.
  try {
    const { stdout } = await execFileAsync(
      'rg',
      ['--line-number', '--no-heading', '--color', 'never', ...include, '-e', args.pattern, target],
      { cwd, maxBuffer: 10 * 1024 * 1024, signal, timeout: SCAN_TIMEOUT_MS },
    );
    return { content: clip(stdout || 'Không có kết quả.') };
  } catch (error) {
    const err = error as { code?: string | number; stdout?: string; stderr?: string; message: string; name?: string };
    if (err.name === 'AbortError' || signal.aborted) throw new Error('Đã huỷ bởi người dùng.');
    if (err.code === 'ENOENT') return grepFallback(cwd, args, signal);
    if (err.stdout) return { content: clip(err.stdout) };
    if (err.code === 1) return { content: 'Không có kết quả.' };
    if (err.code === 'ETIMEDOUT') {
      return { content: `grep quá ${SCAN_TIMEOUT_MS / 1000}s chưa xong; thu hẹp "path" hoặc thêm "glob".`, isError: true };
    }
    return { content: clip(err.stderr || err.message), isError: true };
  }
}

// Fallback thuần Node khi máy không có ripgrep.
export async function grepFallback(
  cwd: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
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
      // Kiểm tra signal mỗi thư mục để Esc dừng được giữa chừng, không quét hết cây.
      if (signal?.aborted) throw new Error('Đã huỷ bởi người dùng.');
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) || SKIP_SYSTEM_DIRS.has(entry.name)) continue;
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
export function createTools(cwd: string, state: ToolState = createToolState()): ToolSpec[] {
  return [
    {
      name: 'Read',
      description:
        'Đọc file kèm số dòng. "file_path" phải là đường dẫn tuyệt đối. Mặc định đọc 2000 dòng đầu; dùng offset/limit cho file dài.',
      needsApproval: false,
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Đường dẫn tuyệt đối tới file' },
          offset: { type: 'number', description: 'Dòng bắt đầu (1-based)' },
          limit: { type: 'number', description: 'Số dòng tối đa' },
        },
        required: ['file_path'],
      },
      run: (args, signal) => readTool(cwd, args, state, signal),
    },
    {
      name: 'Write',
      description:
        'Ghi đè toàn bộ nội dung file, tạo thư mục cha nếu cần. "file_path" phải tuyệt đối. File đang có phải được Read trước.',
      needsApproval: true,
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Đường dẫn tuyệt đối tới file' },
          content: { type: 'string', description: 'Nội dung đầy đủ' },
        },
        required: ['file_path', 'content'],
      },
      run: (args) => writeTool(args, state),
    },
    {
      name: 'Edit',
      description:
        'Thay thế chuỗi chính xác trong file; phải Read file trước. "old_string" phải duy nhất, hoặc dùng replace_all để thay mọi chỗ.',
      needsApproval: true,
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Đường dẫn tuyệt đối tới file' },
          old_string: { type: 'string', description: 'Chuỗi cần thay' },
          new_string: { type: 'string', description: 'Chuỗi thay thế, phải khác old_string' },
          replace_all: { type: 'boolean', description: 'Thay tất cả lần xuất hiện' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
      run: (args) => editTool(args, state),
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
      run: (args, signal) => grepTool(cwd, args, signal),
    },
    {
      name: 'Glob',
      description:
        'Liệt kê file khớp pattern, ví dụ **/*.ts, sắp theo thời gian sửa mới nhất. Dùng "path" để đổi thư mục gốc (tuyệt đối).',
      needsApproval: false,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern' },
          path: { type: 'string', description: 'Thư mục gốc tuyệt đối, mặc định là thư mục làm việc' },
        },
        required: ['pattern'],
      },
      run: (args, signal) => globTool(cwd, args, signal),
    },
  ];
}
