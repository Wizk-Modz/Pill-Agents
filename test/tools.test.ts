// Kiểm thử tool file và input reducer bằng assert.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    await rm(dir, { recursive: true, force: true });
  }
}

// Lấy tool theo tên.
function tool(dir: string, name: string) {
  const found = createTools(dir).find((item) => item.name === name);
  assert.ok(found, `thiếu tool ${name}`);
  return found;
}

test('write_file rồi read_file trả đúng nội dung', async () => {
  await withTempDir(async (dir) => {
    const write = tool(dir, 'write_file');
    const read = tool(dir, 'read_file');
    const signal = new AbortController().signal;
    await write.run({ path: 'a/b.txt', content: 'xin chào' }, signal);
    const result = await read.run({ path: 'a/b.txt' }, signal);
    assert.match(result.content, /xin chào/);
    assert.equal(await readFile(path.join(dir, 'a/b.txt'), 'utf8'), 'xin chào');
  });
});

test('edit_file từ chối chuỗi khớp nhiều lần', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'x.txt'), 'a a a', 'utf8');
    const edit = tool(dir, 'edit_file');
    await assert.rejects(() => edit.run({ path: 'x.txt', old_string: 'a', new_string: 'b' }, new AbortController().signal), /3 lần/);
  });
});

test('edit_file thay toàn bộ khi replace_all', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'x.txt'), 'a a', 'utf8');
    const edit = tool(dir, 'edit_file');
    await edit.run({ path: 'x.txt', old_string: 'a', new_string: 'b', replace_all: true }, new AbortController().signal);
    assert.equal(await readFile(path.join(dir, 'x.txt'), 'utf8'), 'b b');
  });
});

test('edit_file giữ nguyên new_string có ký tự $ đặc biệt của String.replace', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'x.txt'), 'echo A\n', 'utf8');
    const edit = tool(dir, 'edit_file');
    await edit.run({ path: 'x.txt', old_string: 'A', new_string: 'B$&C$1$\'`' }, new AbortController().signal);
    assert.equal(await readFile(path.join(dir, 'x.txt'), 'utf8'), 'echo B$&C$1$\'`\n');
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

test('glob và grep tìm đúng file', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'a.ts'), 'const needle = 1;', 'utf8');
    await writeFile(path.join(dir, 'b.js'), 'needle', 'utf8');
    const glob = tool(dir, 'glob');
    const grep = tool(dir, 'grep');
    const signal = new AbortController().signal;
    const globResult = await glob.run({ pattern: '*.ts' }, signal);
    assert.match(globResult.content, /a\.ts/);
    const grepResult = await grep.run({ pattern: 'needle', glob: '*.ts' }, signal);
    assert.match(grepResult.content, /a\.ts:1/);
    assert.doesNotMatch(grepResult.content, /b\.js/);
  });
});

test('grep tìm được pattern bắt đầu bằng dấu gạch ngang', async () => {
  await withTempDir(async (dir) => {
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
