// Kiểm thử việc nạp file hướng dẫn PILL.md.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadInstructions, renderInstructions } from '../src/instructions.js';

// Tạo cây thư mục tạm cho mỗi test.
async function withTempTree(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'pill-md-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('nạp PILL.md global và PILL.md dự án', async () => {
  await withTempTree(async (root) => {
    const configDir = path.join(root, 'config');
    const project = path.join(root, 'project');
    await mkdir(configDir, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(path.join(configDir, 'PILL.md'), 'Luôn trả lời tiếng Việt.', 'utf8');
    await writeFile(path.join(project, 'PILL.md'), 'Dự án dùng pnpm.', 'utf8');

    const files = loadInstructions(project, configDir);
    assert.equal(files.length, 2);
    assert.match(files[0]!.content, /tiếng Việt/);
    assert.match(files[1]!.content, /pnpm/);
  });
});

test('nạp PILL.md từ thư mục cha, gần nhất sau cùng', async () => {
  await withTempTree(async (root) => {
    const configDir = path.join(root, 'config');
    await mkdir(configDir, { recursive: true });
    const outer = path.join(root, 'outer');
    const inner = path.join(outer, 'inner');
    await mkdir(inner, { recursive: true });
    await writeFile(path.join(outer, 'PILL.md'), 'Ngoài', 'utf8');
    await writeFile(path.join(inner, 'PILL.md'), 'Trong', 'utf8');

    const files = loadInstructions(inner, configDir);
    const contents = files.map((file) => file.content);
    assert.deepEqual(contents, ['Ngoài', 'Trong'], 'thư mục gần nhất phải ở cuối');
  });
});

test('bỏ qua file rỗng và thư mục không có PILL.md', async () => {
  await withTempTree(async (root) => {
    const configDir = path.join(root, 'config');
    const project = path.join(root, 'project');
    await mkdir(configDir, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'PILL.md'), '   \n\n  ', 'utf8');

    const files = loadInstructions(project, configDir);
    assert.equal(files.length, 0);
  });
});

test('renderInstructions gắn nhãn global và dự án', () => {
  const text = renderInstructions([
    { path: '/home/u/.pill/PILL.md', label: 'hướng dẫn chung', content: 'A' },
    { path: '/proj/PILL.md', label: 'hướng dẫn của dự án', content: 'B' },
  ]);
  assert.match(text, /GHI ĐÈ hành vi mặc định/);
  assert.match(text, /Contents of \/home\/u\/\.pill\/PILL\.md/);
  assert.match(text, /Contents of \/proj\/PILL\.md/);
});

test('renderInstructions trả chuỗi rỗng khi không có file', () => {
  assert.equal(renderInstructions([]), '');
});
