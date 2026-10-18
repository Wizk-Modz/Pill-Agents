// Dòng trạng thái tự cấu hình: chạy lệnh trong settings.json và lấy dòng đầu của stdout.
import { spawn } from 'node:child_process';
import { childEnv, resolveShell } from './tools.js';

const STATUS_TIMEOUT_MS = 5000;
const MAX_OUTPUT_CHARS = 65536;
const MAX_LINE_CHARS = 500;

// Dữ liệu gửi cho lệnh statusLine qua stdin dưới dạng JSON.
export type StatusLineInput = {
  version: string;
  model: string;
  effort?: string;
  cwd: string;
  tokens: { prompt: number; completion: number };
  busy: boolean;
  queued: number;
};

// Lấy dòng đầu không rỗng của output, cắt bớt nếu quá dài.
export function firstLine(output: string): string | undefined {
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, MAX_LINE_CHARS);
  }
  return undefined;
}

// Chạy lệnh statusLine với JSON gửi qua stdin, trả dòng đầu của stdout hoặc undefined nếu lỗi.
export function runStatusLine(options: {
  command: string;
  cwd: string;
  input: StatusLineInput;
  timeoutMs?: number;
}): Promise<string | undefined> {
  const { command, cwd, input, timeoutMs = STATUS_TIMEOUT_MS } = options;
  return new Promise((resolve) => {
    const shell = resolveShell();
    const child = spawn(shell.command, [...shell.args, command], {
      cwd,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    let output = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value?: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    timer = setTimeout(() => {
      child.kill();
      finish();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (output.length < MAX_OUTPUT_CHARS) output += chunk;
    });
    // Lệnh không đọc stdin có thể đóng pipe sớm; bỏ qua lỗi ghi để không làm sập app.
    child.stdin.on('error', () => {});
    child.on('error', () => finish());
    child.on('close', (code) => finish(code === 0 ? firstLine(output) : undefined));
    child.stdin.end(JSON.stringify(input));
  });
}
