// Kiểm thử dòng trạng thái tự cấu hình: đọc settings.json, chạy lệnh và lấy dòng đầu stdout.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStatusLine } from '../src/config.js';
import { firstLine, runStatusLine, type StatusLineInput } from '../src/statusline.js';

const INPUT: StatusLineInput = {
  version: 'pill 0.1.0',
  model: 'gpt-4o-mini',
  effort: 'high',
  cwd: '/du-an/mau',
  tokens: { prompt: 42, completion: 7 },
  busy: false,
  queued: 2,
};

// Tạo thư mục tạm rồi dọn sạch sau khi chạy xong.
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pill-status-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Ghi script Node vào thư mục tạm và trả về lệnh để chạy nó.
async function writeScript(dir: string, name: string, source: string): Promise<string> {
  await writeFile(path.join(dir, name), source, 'utf8');
  return `node ${name}`;
}

test('parseStatusLine nhận lệnh hợp lệ và cắt khoảng trắng', () => {
  assert.deepEqual(parseStatusLine({ type: 'command', command: '  ~/.pill/sl.sh  ' }), {
    type: 'command',
    command: '~/.pill/sl.sh',
  });
  assert.deepEqual(parseStatusLine({ command: 'sl.sh' }), { command: 'sl.sh' });
});

test('parseStatusLine bỏ qua giá trị sai kiểu hoặc thiếu lệnh', () => {
  assert.equal(parseStatusLine(undefined), undefined);
  assert.equal(parseStatusLine('sl.sh'), undefined);
  assert.equal(parseStatusLine({ type: 'command' }), undefined);
  assert.equal(parseStatusLine({ command: '   ' }), undefined);
  assert.equal(parseStatusLine({ type: 'api', command: 'sl.sh' }), undefined);
});

test('firstLine lấy dòng đầu không rỗng và cắt bớt dòng quá dài', () => {
  assert.equal(firstLine('  \n  xin chào  \n dòng hai'), 'xin chào');
  assert.equal(firstLine('   \n\n  '), undefined);
  assert.equal(firstLine('a'.repeat(600))?.length, 500);
});

test('runStatusLine nhận JSON qua stdin và chỉ lấy dòng đầu của stdout', async () => {
  await withTempDir(async (dir) => {
    const command = await writeScript(
      dir,
      'doc.mjs',
      "let raw = '';\nprocess.stdin.on('data', (chunk) => { raw += chunk; });\nprocess.stdin.on('end', () => {\n  const input = JSON.parse(raw);\n  console.log('model=' + input.model);\n  console.log('dòng thứ hai bị bỏ qua');\n});\n",
    );
    const line = await runStatusLine({ command, cwd: dir, input: INPUT });
    assert.equal(line, 'model=gpt-4o-mini');
  });
});

test('runStatusLine gửi đủ dữ liệu phiên cho lệnh', async () => {
  await withTempDir(async (dir) => {
    const command = await writeScript(
      dir,
      'echo.mjs',
      "let raw = '';\nprocess.stdin.on('data', (chunk) => { raw += chunk; });\nprocess.stdin.on('end', () => console.log(JSON.stringify(JSON.parse(raw))));\n",
    );
    const line = await runStatusLine({ command, cwd: dir, input: INPUT });
    assert.deepEqual(JSON.parse(line ?? 'null'), INPUT);
  });
});

test('runStatusLine chạy lệnh trong thư mục dự án và có TMPDIR', async () => {
  await withTempDir(async (dir) => {
    const command = await writeScript(
      dir,
      'cwd.mjs',
      "console.log(process.cwd() + '|' + process.env.TMPDIR);\n",
    );
    const line = await runStatusLine({ command, cwd: dir, input: INPUT });
    assert.equal(line, `${await realpath(dir)}|${tmpdir()}`);
  });
});

test('runStatusLine trả undefined khi lệnh lỗi, không in gì hoặc không tồn tại', async () => {
  await withTempDir(async (dir) => {
    const empty = await writeScript(dir, 'rong.mjs', 'process.exit(0);\n');
    assert.equal(await runStatusLine({ command: empty, cwd: dir, input: INPUT }), undefined);
    const failing = await writeScript(dir, 'loi.mjs', 'process.exit(3);\n');
    assert.equal(await runStatusLine({ command: failing, cwd: dir, input: INPUT }), undefined);
    const missing = await runStatusLine({ command: 'pill-khong-ton-tai-xyz', cwd: dir, input: INPUT });
    assert.equal(missing, undefined);
  });
});

test('runStatusLine dừng lệnh chạy quá thời gian cho phép', async () => {
  await withTempDir(async (dir) => {
    const command = await writeScript(dir, 'cham.mjs', 'setTimeout(() => {}, 30000);\n');
    const started = Date.now();
    const line = await runStatusLine({ command, cwd: dir, input: INPUT, timeoutMs: 300 });
    assert.equal(line, undefined);
    assert.ok(Date.now() - started < 5000, 'không cắt lệnh đúng hạn');
  });
});
