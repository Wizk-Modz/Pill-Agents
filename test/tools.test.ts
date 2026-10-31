// Kiểm thử tool file và input reducer bằng assert.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EMPTY_KEY as noKey, reduceInput, reduceString } from '../src/ui/InputBox.js';
import { childEnv, createTools, grepFallback, resolveShell } from '../src/tools.js';

// Tạo thư mục tạm cho mỗi test.
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pill-test-'));
  try {
    await run(dir);
  } finally {
    toolCache.delete(dir);
    await rm(dir, { recursive: true, force: true });
  }
}

// Cache bộ tool theo thư mục để mọi lần gọi trong một test dùng chung trạng thái đã đọc.
const toolCache = new Map<string, ReturnType<typeof createTools>>();

// Lấy tool theo tên, giữ nguyên danh sách của thư mục.
function tool(dir: string, name: string) {
  let list = toolCache.get(dir);
  if (!list) {
    list = createTools(dir);
    toolCache.set(dir, list);
  }
  const found = list.find((item) => item.name === name);
  assert.ok(found, `thiếu tool ${name}`);
  return found;
}

test('Write rồi Read trả đúng nội dung', async () => {
  await withTempDir(async (dir) => {
    const write = tool(dir, 'Write');
    const read = tool(dir, 'Read');
    const signal = new AbortController().signal;
    const target = path.join(dir, 'a/b.txt');
    await write.run({ file_path: target, content: 'xin chào' }, signal);
    const result = await read.run({ file_path: target }, signal);
    assert.match(result.content, /xin chào/);
    assert.equal(await readFile(target, 'utf8'), 'xin chào');
  });
});

test('Read, Write và Edit từ chối đường dẫn tương đối', async () => {
  await withTempDir(async (dir) => {
    const signal = new AbortController().signal;
    await assert.rejects(() => tool(dir, 'Read').run({ file_path: 'a.txt' }, signal), /tuyệt đối/);
    await assert.rejects(() => tool(dir, 'Write').run({ file_path: 'a.txt', content: 'x' }, signal), /tuyệt đối/);
    await assert.rejects(
      () => tool(dir, 'Edit').run({ file_path: 'a.txt', old_string: 'a', new_string: 'b' }, signal),
      /tuyệt đối/,
    );
  });
});

test('Write và Edit từ chối file chưa đọc trong phiên', async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, 'x.txt');
    await writeFile(target, 'nội dung cũ', 'utf8');
    const signal = new AbortController().signal;
    await assert.rejects(() => tool(dir, 'Write').run({ file_path: target, content: 'mới' }, signal), /Chưa đọc/);
    await assert.rejects(
      () => tool(dir, 'Edit').run({ file_path: target, old_string: 'cũ', new_string: 'mới' }, signal),
      /Chưa đọc/,
    );
    // Đọc xong thì cả hai chạy được.
    await tool(dir, 'Read').run({ file_path: target }, signal);
    await tool(dir, 'Edit').run({ file_path: target, old_string: 'cũ', new_string: 'mới' }, signal);
    assert.equal(await readFile(target, 'utf8'), 'nội dung mới');
  });
});

test('Edit từ chối khi new_string trùng old_string', async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, 'x.txt');
    await writeFile(target, 'a', 'utf8');
    const signal = new AbortController().signal;
    await tool(dir, 'Read').run({ file_path: target }, signal);
    await assert.rejects(
      () => tool(dir, 'Edit').run({ file_path: target, old_string: 'a', new_string: 'a' }, signal),
      /phải khác/,
    );
  });
});

test('Read cắt dòng dài hơn 2000 ký tự', async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, 'dai.txt');
    await writeFile(target, `${'x'.repeat(2500)}\ndòng hai`, 'utf8');
    const result = await tool(dir, 'Read').run({ file_path: target }, new AbortController().signal);
    assert.match(result.content, /dòng bị cắt/);
    assert.match(result.content, /dòng hai/);
  });
});

test('Edit từ chối chuỗi khớp nhiều lần', async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, 'x.txt');
    await writeFile(target, 'a a a', 'utf8');
    const signal = new AbortController().signal;
    await tool(dir, 'Read').run({ file_path: target }, signal);
    await assert.rejects(
      () => tool(dir, 'Edit').run({ file_path: target, old_string: 'a', new_string: 'b' }, signal),
      /3 lần/,
    );
  });
});

test('Edit thay toàn bộ khi replace_all', async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, 'x.txt');
    await writeFile(target, 'a a', 'utf8');
    const signal = new AbortController().signal;
    await tool(dir, 'Read').run({ file_path: target }, signal);
    await tool(dir, 'Edit').run({ file_path: target, old_string: 'a', new_string: 'b', replace_all: true }, signal);
    assert.equal(await readFile(target, 'utf8'), 'b b');
  });
});

test('Edit giữ nguyên new_string có ký tự $ đặc biệt của String.replace', async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, 'x.txt');
    await writeFile(target, 'echo A\n', 'utf8');
    const signal = new AbortController().signal;
    await tool(dir, 'Read').run({ file_path: target }, signal);
    await tool(dir, 'Edit').run({ file_path: target, old_string: 'A', new_string: 'B$&C$1$\'`' }, signal);
    assert.equal(await readFile(target, 'utf8'), 'echo B$&C$1$\'`\n');
  });
});

test('bash trả về lỗi thay vì ném khi lệnh fail', async () => {
  await withTempDir(async (dir) => {
    const bash = tool(dir, 'bash');
    const result = await bash.run({ command: 'echo lỗi >&2; exit 3' }, new AbortController().signal);
    assert.equal(result.isError, true);
    assert.match(result.content, /lỗi/);
    assert.equal(result.meta?.exitCode, 3);
  });
});

test('bash gắn exitCode 0 khi lệnh thành công', async () => {
  await withTempDir(async (dir) => {
    const bash = tool(dir, 'bash');
    const result = await bash.run({ command: 'echo ok' }, new AbortController().signal);
    assert.equal(result.isError, undefined);
    assert.equal(result.meta?.exitCode, 0);
  });
});

test('resolveShell chọn shell theo nền tảng', () => {
  assert.deepEqual(resolveShell('linux', {}), { command: '/bin/sh', args: ['-c'] });
  assert.deepEqual(resolveShell('darwin', {}), { command: '/bin/sh', args: ['-c'] });
  assert.deepEqual(resolveShell('win32', { COMSPEC: 'C:\\Windows\\system32\\cmd.exe' }), {
    command: 'C:\\Windows\\system32\\cmd.exe',
    args: ['/d', '/s', '/c'],
  });
  assert.equal(resolveShell('win32', {}).command, 'cmd.exe', 'thiếu COMSPEC thì dùng cmd.exe');
});

test('childEnv bổ sung thư mục tạm khi môi trường cha thiếu', () => {
  const env = childEnv({});
  assert.equal(env.TMPDIR, tmpdir());
  assert.equal(env.TEMP, tmpdir());
  assert.equal(env.TMP, tmpdir());
  const kept = childEnv({ TMPDIR: '/duong/dan/rieng' });
  assert.equal(kept.TMPDIR, '/duong/dan/rieng', 'giữ nguyên giá trị đã có');
  assert.equal(childEnv({ TMPDIR: '' }).TMPDIR, tmpdir(), 'thay cả giá trị rỗng');
});

test('Glob và grep tìm đúng file', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'a.ts'), 'const needle = 1;', 'utf8');
    await writeFile(path.join(dir, 'b.js'), 'needle', 'utf8');
    const glob = tool(dir, 'Glob');
    const grep = tool(dir, 'grep');
    const signal = new AbortController().signal;
    const globResult = await glob.run({ pattern: '*.ts' }, signal);
    assert.match(globResult.content, /a\.ts/);
    const grepResult = await grep.run({ pattern: 'needle', glob: '*.ts' }, signal);
    assert.match(grepResult.content, /a\.ts:1/);
    assert.doesNotMatch(grepResult.content, /b\.js/);
  });
});

test('Glob sắp theo thời gian sửa mới nhất và nhận path tuyệt đối', async () => {
  await withTempDir(async (dir) => {
    const sub = path.join(dir, 'sub');
    await mkdir(sub, { recursive: true });
    const older = path.join(sub, 'cu.ts');
    const newer = path.join(sub, 'moi.ts');
    await writeFile(older, '', 'utf8');
    await writeFile(newer, '', 'utf8');
    // Đặt mtime cách nhau để thứ tự không phụ thuộc độ phân giải của hệ tệp.
    const past = new Date(Date.now() - 60_000);
    await utimes(older, past, past);
    const result = await tool(dir, 'Glob').run(
      { pattern: '*.ts', path: sub },
      new AbortController().signal,
    );
    const lines = result.content.split('\n');
    assert.equal(lines[0], newer, 'file mới sửa phải đứng trước');
    assert.equal(lines[1], older);
    await assert.rejects(
      () => tool(dir, 'Glob').run({ pattern: '*.ts', path: 'sub' }, new AbortController().signal),
      /tuyệt đối/,
    );
  });
});

test('Glob bỏ qua thư mục hệ thống và dừng khi bị huỷ', async () => {
  await withTempDir(async (dir) => {
    // node_modules và proc không bao giờ chứa kết quả mong muốn nhưng rất nặng khi quét.
    await mkdir(path.join(dir, 'node_modules/pkg'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules/pkg/target.md'), '', 'utf8');
    await mkdir(path.join(dir, 'proc'), { recursive: true });
    await writeFile(path.join(dir, 'proc/target.md'), '', 'utf8');
    const real = path.join(dir, 'that.md');
    await writeFile(real, '', 'utf8');

    const result = await tool(dir, 'Glob').run(
      { pattern: '**/*.md', path: dir },
      new AbortController().signal,
    );
    assert.equal(result.content, real, 'chỉ trả file thật, không trả file trong thư mục bị bỏ qua');

    // Huỷ trước khi chạy phải ném ngay thay vì quét xong mới trả.
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => tool(dir, 'Glob').run({ pattern: '**/*.md', path: dir }, controller.signal),
      /Đã huỷ/,
    );
  });
});

test('grep nhận signal và dừng khi bị huỷ', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'a.ts'), 'needle', 'utf8');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => tool(dir, 'grep').run({ pattern: 'needle', path: dir }, controller.signal),
      /Đã huỷ/,
    );
  });
});

test('grep tìm được pattern bắt đầu bằng dấu gạch ngang', async () => {  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'co.txt'), 'dòng có -ok trong đó', 'utf8');
    const grep = tool(dir, 'grep');
    const result = await grep.run({ pattern: '-ok' }, new AbortController().signal);
    assert.match(result.content, /-ok/);
  });
});

test('grepFallback trả lỗi thay vì ném khi regex không hợp lệ', async () => {
  await withTempDir(async (dir) => {
    const result = await grepFallback(dir, { pattern: 'a(' });
    assert.equal(result.isError, true);
    assert.match(result.content, /Invalid regular expression/i);
  });
});

test('reduceInput gửi khi Enter và không gửi khi rỗng', () => {
  const enter = { ...noKey, return: true };
  const typed = reduceInput({ value: '', cursor: 0, historyIndex: -1 }, 'h', noKey, []);
  const submitted = reduceInput({ value: 'hi', cursor: 2, historyIndex: -1 }, '', enter, []);
  assert.equal(typed.state.value, 'h');
  assert.equal(submitted.submit, 'hi');
  assert.equal(reduceInput({ value: '  ', cursor: 2, historyIndex: -1 }, '', enter, []).submit, undefined);
});

test('Ctrl+U và Ctrl+K xoá theo dòng hiện tại, không xoá cả prompt nhiều dòng', () => {
  const ctrl = { ...noKey, ctrl: true };
  // Con trỏ giữa dòng thứ hai: Ctrl+U chỉ xoá từ đầu dòng hai.
  const up = reduceInput({ value: 'một\nhai ba', cursor: 7, historyIndex: -1 }, 'u', ctrl, []);
  assert.equal(up.state.value, 'một\n ba');
  assert.equal(up.state.cursor, 4);
  // Ctrl+K xoá đến hết dòng hai, giữ nguyên dòng một và dấu xuống dòng.
  const down = reduceInput({ value: 'một\nhai ba', cursor: 7, historyIndex: -1 }, 'k', ctrl, []);
  assert.equal(down.state.value, 'một\nhai');
  assert.equal(down.state.cursor, 7);
  // Ở dòng đầu nhiều dòng, Ctrl+K không nuốt dòng sau.
  const firstLine = reduceInput({ value: 'ab\ncd', cursor: 1, historyIndex: -1 }, 'k', ctrl, []);
  assert.equal(firstLine.state.value, 'a\ncd');
});

test('reduceInput chèn xuống dòng khi gõ "\\" rồi Enter', () => {
  const enter = { ...noKey, return: true };
  const result = reduceInput({ value: 'dòng 1\\', cursor: 7, historyIndex: -1 }, '', enter, []);
  assert.equal(result.submit, undefined);
  assert.equal(result.state.value, 'dòng 1\n');
  assert.equal(result.state.cursor, 7);
});

test('reduceString xử lý "\\" + Enter dính liền thành xuống dòng', () => {
  const result = reduceString({ value: 'abc', cursor: 3, historyIndex: -1 }, '\\\r', []);
  assert.equal(result.submit, undefined);
  assert.equal(result.state.value, 'abc\n');
});

test('reduceString gửi khi chuỗi paste kết thúc bằng newline', () => {
  const result = reduceString({ value: '', cursor: 0, historyIndex: -1 }, 'xin chào\r', []);
  assert.equal(result.submit, 'xin chào');
  assert.equal(result.state.value, '');
});

test('reduceString giữ newline ở giữa nhưng gửi ở cuối', () => {
  const result = reduceString({ value: '', cursor: 0, historyIndex: -1 }, 'a\nb\r', []);
  assert.equal(result.submit, 'a\nb');
});

test('reduceInput di chuyển lịch sử và sửa ký tự', () => {
  const up = { ...noKey, upArrow: true };
  const history = ['một', 'hai'];
  const recalled = reduceInput({ value: '', cursor: 0, historyIndex: -1 }, '', up, history);
  assert.equal(recalled.state.value, 'hai');
  const backspace = { ...noKey, backspace: true };
  const edited = reduceInput({ value: 'abc', cursor: 2, historyIndex: -1 }, '', backspace, []);
  assert.equal(edited.state.value, 'ac');
  assert.equal(edited.state.cursor, 1);
});

test('formatTokens rút gọn số lớn', async () => {
  const { formatTokens } = await import('../src/ui/format.js');
  assert.equal(formatTokens(42), '42');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1.0k');
  assert.equal(formatTokens(12345), '12.3k');
  assert.equal(formatTokens(1000000), '1000.0k');
});
