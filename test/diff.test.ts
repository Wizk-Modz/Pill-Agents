// Kiểm thử thuật toán so sánh dòng dùng cho thẻ tool và hộp duyệt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { diffLines } from '../src/ui/diff.js';

test('diffLines nhận diện dòng thay đổi và giữ dòng context', () => {
  const result = diffLines('a\nb\nc', 'a\nB\nc');
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.equal(result.truncated, false);
  assert.ok(result.lines.some((line) => line.kind === 'remove' && line.text === 'b'));
  assert.ok(result.lines.some((line) => line.kind === 'add' && line.text === 'B'));
  assert.ok(result.lines.some((line) => line.kind === 'context' && line.text === 'a'));
  assert.ok(result.lines.some((line) => line.kind === 'context' && line.text === 'c'));
});

test('diffLines nhận diện thêm và bớt dòng', () => {
  const added = diffLines('a\nc', 'a\nb\nc');
  assert.equal(added.added, 1);
  assert.equal(added.removed, 0);
  assert.ok(added.lines.some((line) => line.kind === 'add' && line.text === 'b'));

  const removed = diffLines('a\nb\nc', 'a\nc');
  assert.equal(removed.added, 0);
  assert.equal(removed.removed, 1);
  assert.ok(removed.lines.some((line) => line.kind === 'remove' && line.text === 'b'));
});

test('diffLines giới hạn số dòng và đánh dấu truncated', () => {
  const result = diffLines('a\nb\nc', 'a\nb\nc', 1);
  assert.equal(result.truncated, true);
  assert.ok(result.lines.at(-1)!.text.includes('chỉ so sánh 1 dòng'));
});

test('diffLines trả rỗng khi hai chuỗi rỗng', () => {
  const result = diffLines('', '');
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
  assert.equal(result.lines.length, 1);
});
