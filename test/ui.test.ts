// Kiểm thử định dạng hiển thị, hit-test chuột, hộp duyệt và thẻ tool.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ToolCall } from '../src/types.js';
import { buildApprovalLines, isDangerousCommand } from '../src/ui/approval.js';
import { fitText, formatDuration, formatElapsed, formatTokens, shortenCwd } from '../src/ui/format.js';
import { hitTestColumn, hitTestLine, type LineOwner } from '../src/ui/hitTest.js';
import { itemToLines } from '../src/ui/Transcript.js';

// Tạo thư mục tạm cho mỗi test.
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pill-ui-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Tạo tool call với tham số JSON.
function call(name: string, args: Record<string, unknown>, id = 'call-1'): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

// Bỏ mã màu ANSI để so sánh nội dung hiển thị.
function plain(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

test('formatTokens, formatDuration và formatElapsed rút gọn đúng', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(12345), '12.3k');
  assert.equal(formatDuration(450), '450ms');
  assert.equal(formatDuration(1500), '1.5s');
  assert.equal(formatDuration(65_000), '1m 05s');
  assert.equal(formatElapsed(32_000), '32s');
  assert.equal(formatElapsed(65_000), '1m 05s');
});

test('shortenCwd thay thư mục nhà bằng ~ và giữ đường dẫn ngoài', () => {
  const home = path.join(path.sep, 'home', 'an');
  assert.equal(shortenCwd(path.join(home, 'du-an'), home), `~${path.sep}du-an`);
  assert.equal(shortenCwd(home, home), '~');
  assert.equal(shortenCwd(path.join(path.sep, 'khac'), home), path.join(path.sep, 'khac'));
});

test('fitText cắt theo code point và thêm dấu …', () => {
  assert.equal(fitText('abc', 4), 'abc');
  assert.equal(fitText('abcdef', 4), 'abc…');
  assert.equal(fitText('😀😀😀', 2), '😀…');
});

test('hitTestLine đổi tọa độ chuột 1-based sang dòng transcript', () => {
  const owners: LineOwner[] = [
    { id: 1, kind: 'user', header: false },
    { id: 2, kind: 'thinking', header: true },
    { id: 2, kind: 'thinking', header: false },
    { id: 3, kind: 'tool', header: true },
  ];
  const at = (row: number) => hitTestLine(owners, { top: 1, transcriptTop: 3, row });
  assert.equal(at(4)?.id, 2);
  assert.equal(at(4)?.header, true);
  assert.equal(at(5)?.header, false);
  assert.equal(at(6)?.kind, 'tool');
  assert.equal(at(3), undefined, 'dòng thuộc header của app');
  assert.equal(at(10), undefined, 'ngoài vùng transcript');
  const clipped = (row: number) => hitTestLine(owners, { top: 0, transcriptTop: 3, row, height: 4 });
  assert.equal(clipped(7)?.kind, 'tool', 'dòng cuối vùng nhìn thấy vẫn click được');
  assert.equal(clipped(8), undefined, 'click dưới đáy transcript bị bỏ qua');
});

test('hitTestColumn giới hạn click trong vùng transcript', () => {
  assert.equal(hitTestColumn(1, 0, 80), true);
  assert.equal(hitTestColumn(80, 0, 80), true);
  assert.equal(hitTestColumn(0, 0, 80), false);
  assert.equal(hitTestColumn(81, 0, 80), false);
  assert.equal(hitTestColumn(15, 10, 20), true);
  assert.equal(hitTestColumn(9, 10, 20), false);
});

test('isDangerousCommand phát hiện lệnh phá huỷ và không báo nhầm lệnh thường', () => {
  assert.equal(isDangerousCommand('rm -rf build'), true);
  assert.equal(isDangerousCommand('sudo rm -r thu-muc'), true);
  assert.equal(isDangerousCommand('git reset --hard HEAD'), true);
  assert.equal(isDangerousCommand('git clean -fdx'), true);
  assert.equal(isDangerousCommand('npm test'), false);
  assert.equal(isDangerousCommand('git status'), false);
});

test('buildApprovalLines hiện diff edit_file và nút duyệt', () => {
  const lines = buildApprovalLines(
    call('edit_file', { path: 'a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' }),
    { width: 80, expanded: false, cwd: process.cwd(), maxPreview: 8 },
  );
  const text = lines.join('\n');
  assert.ok(text.includes('Cho phép chạy'));
  assert.ok(text.includes('+1'));
  assert.ok(text.includes('−1'));
  assert.ok(text.includes('[y]'));
  assert.ok(text.includes('[d]'));
  assert.ok(lines.length <= 3 + 8, `hộp duyệt quá cao: ${lines.length}`);
});

test('buildApprovalLines cảnh báo lệnh nguy hiểm và file ghi đè', async () => {
  const bash = buildApprovalLines(call('bash', { command: 'rm -rf build' }), {
    width: 80,
    expanded: false,
    cwd: process.cwd(),
    maxPreview: 4,
  });
  assert.ok(bash.join('\n').includes('phá huỷ'));
  assert.ok(bash.length <= 4 + 4);

  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'a.txt'), 'cũ', 'utf8');
    const write = buildApprovalLines(call('write_file', { path: 'a.txt', content: 'mới' }), {
      width: 80,
      expanded: false,
      cwd: dir,
      maxPreview: 4,
    });
    assert.ok(write.join('\n').includes('ghi đè'));
    assert.ok(write.length <= 4 + 4);
  });
});

test('buildApprovalLines mở rộng hiện nhiều dòng hơn bản thu gọn', () => {
  const content = Array.from({ length: 30 }, (_, index) => `dòng ${index + 1}`).join('\n');
  const compact = buildApprovalLines(call('write_file', { path: 'a.txt', content }), {
    width: 80,
    expanded: false,
    cwd: process.cwd(),
    maxPreview: 6,
  });
  const expanded = buildApprovalLines(call('write_file', { path: 'a.txt', content }), {
    width: 80,
    expanded: true,
    cwd: process.cwd(),
    maxPreview: 20,
  });
  assert.ok(expanded.length > compact.length);
  assert.ok(compact.join('\n').includes('+24 dòng'));
});

test('itemToLines hiện thẻ tool có thời gian, thống kê và marker mở rộng', () => {
  const lines = itemToLines(
    {
      id: 1,
      kind: 'tool',
      call: call('read_file', { path: 'a.ts' }),
      result: { content: 'một\ndòng', meta: { durationMs: 500 } },
      expanded: false,
    },
    80,
  );
  const text = plain(lines.join('\n'));
  assert.ok(text.includes('read_file'));
  assert.ok(text.includes('500ms'));
  assert.ok(text.includes('2 dòng'));
  assert.ok(text.includes('▸'));
});

test('itemToLines hiện diff edit_file khi mở rộng', () => {
  const lines = itemToLines(
    {
      id: 2,
      kind: 'tool',
      call: call('edit_file', { path: 'a.ts', old_string: 'cũ', new_string: 'mới' }),
      result: { content: 'Đã sửa', meta: { durationMs: 1200 } },
      expanded: true,
    },
    80,
  );
  const text = plain(lines.join('\n'));
  assert.ok(text.includes('▾'));
  assert.ok(text.includes('- cũ'));
  assert.ok(text.includes('+ mới'));
});

test('itemToLines thu gọn thinking có marker và gợi ý click', () => {
  const lines = itemToLines({ id: 3, kind: 'thinking', text: 'suy nghĩ', expanded: false, seconds: 2 }, 80);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes('▸'));
  assert.ok(lines[0]!.includes('click'));
});
