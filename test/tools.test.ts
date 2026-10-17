// Kiểm thử tool file và input reducer bằng assert.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTools } from '../src/tools.js';
import { EMPTY_KEY as noKey, reduceInput, reduceString } from '../src/ui/InputBox.js';

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

test('bash trả về lỗi thay vì ném khi lệnh fail', async () => {
  await withTempDir(async (dir) => {
    const bash = tool(dir, 'bash');
    const result = await bash.run({ command: 'echo lỗi >&2; exit 3' }, new AbortController().signal);
    assert.equal(result.isError, true);
    assert.match(result.content, /lỗi/);
  });
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

test('reduceInput gửi khi Enter và không gửi khi rỗng', () => {
  const enter = { ...noKey, return: true };
  const typed = reduceInput({ value: '', cursor: 0, historyIndex: -1 }, 'h', noKey, []);
  const submitted = reduceInput({ value: 'hi', cursor: 2, historyIndex: -1 }, '', enter, []);
  assert.equal(typed.state.value, 'h');
  assert.equal(submitted.submit, 'hi');
  assert.equal(reduceInput({ value: '  ', cursor: 2, historyIndex: -1 }, '', enter, []).submit, undefined);
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
