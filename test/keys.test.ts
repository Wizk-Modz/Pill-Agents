// Kiểm thử bộ parse phím thô và render markdown.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInput } from '../src/ui/useKeys.js';
import { renderMarkdown } from '../src/ui/markdown.js';
import { reduceInput, EMPTY_KEY } from '../src/ui/InputBox.js';

// Lấy sự kiện phím đầu tiên sau khi parse.
function firstKey(buffer: string, flush = true) {
  const { events } = parseInput(buffer, flush);
  assert.ok(events.length > 0, 'không có sự kiện');
  return events[0]!;
}

test('parseInput nhận diện mũi tên khi escape bị tách thành nhiều chunk', () => {
  const first = parseInput('\x1b', false);
  assert.equal(first.events.length, 0, 'phải chờ thêm byte');
  assert.equal(first.rest, '\x1b');
  const second = parseInput(first.rest + '[A', false);
  assert.equal(second.events.length, 1);
  const event = second.events[0]!;
  assert.equal(event.type, 'key');
  assert.ok(event.type === 'key' && event.key.upArrow);
});

test('parseInput nhận diện mũi tên xuống, pageup, pagedown', () => {
  const down = firstKey('\x1b[B');
  assert.ok(down.type === 'key' && down.key.downArrow);
  const pageUp = firstKey('\x1b[5~');
  assert.ok(pageUp.type === 'key' && pageUp.key.pageUp);
  const pageDown = firstKey('\x1b[6~');
  assert.ok(pageDown.type === 'key' && pageDown.key.pageDown);
});

test('parseInput nhận diện shift+mũi tên', () => {
  const event = firstKey('\x1b[1;2A');
  assert.ok(event.type === 'key' && event.key.upArrow && event.key.shift);
});

test('parseInput nhận diện lăn chuột SGR', () => {
  const up = firstKey('\x1b[<64;10;5M');
  assert.equal(up.type, 'wheel');
  assert.ok(up.type === 'wheel' && up.direction === 'up');
  const down = firstKey('\x1b[<65;10;5M');
  assert.ok(down.type === 'wheel' && down.direction === 'down');
});

test('parseInput nhận diện bracketed paste và giữ nguyên newline', () => {
  const event = firstKey('\x1b[200~dòng 1\ndòng 2\x1b[201~');
  assert.equal(event.type, 'paste');
  assert.ok(event.type === 'paste' && event.text === 'dòng 1\ndòng 2');
});

test('parseInput tách Ctrl+C và Enter đúng', () => {
  const ctrlC = firstKey('\x03');
  assert.ok(ctrlC.type === 'key' && ctrlC.key.ctrl && ctrlC.char === 'c');
  const enter = firstKey('\r');
  assert.ok(enter.type === 'key' && enter.key.return);
});

test('parseInput giữ nguyên tiếng Việt có dấu', () => {
  const event = firstKey('xin chào');
  assert.equal(event.type, 'text');
  assert.ok(event.type === 'text' && event.text === 'xin chào');
});

test('reduceInput: ↑ gọi lịch sử từ mới đến cũ, ↓ quay về draft', () => {
  const history = ['lệnh một', 'lệnh hai'];
  const up1 = reduceInput({ value: '', cursor: 0, historyIndex: -1 }, '', { ...EMPTY_KEY, upArrow: true }, history);
  assert.equal(up1.state.value, 'lệnh hai');
  const up2 = reduceInput(up1.state, '', { ...EMPTY_KEY, upArrow: true }, history);
  assert.equal(up2.state.value, 'lệnh một');
  const down1 = reduceInput(up2.state, '', { ...EMPTY_KEY, downArrow: true }, history);
  assert.equal(down1.state.value, 'lệnh hai');
  const down2 = reduceInput(down1.state, '', { ...EMPTY_KEY, downArrow: true }, history);
  assert.equal(down2.state.value, '', 'về lại draft rỗng');
});

test('reduceInput: ↑/↓ di chuyển giữa các dòng khi đang soạn nhiều dòng', () => {
  const value = 'dòng một\ndòng hai';
  const cursor = value.indexOf('hai') + 3;
  const up = reduceInput({ value, cursor, historyIndex: -1 }, '', { ...EMPTY_KEY, upArrow: true }, ['x']);
  assert.equal(up.state.value, value, 'không được đổi sang lịch sử');
  assert.equal(up.state.cursor, 8, 'giữ cột cuối dòng đầu');
  const down = reduceInput(up.state, '', { ...EMPTY_KEY, downArrow: true }, ['x']);
  assert.equal(down.state.cursor, cursor, 'quay lại đúng vị trí dòng hai');
});

test('renderMarkdown: heading, bullet, code fence và inline', () => {
  const lines = renderMarkdown('# Tiêu đề\n- mục **đậm**\n```\ncode\n```', 60);
  const plain = lines.map((segments) => segments.map((segment) => segment.text).join(''));
  assert.ok(plain.some((line) => line.includes('Tiêu đề')));
  assert.ok(plain.some((line) => line.includes('• mục đậm')));
  assert.ok(plain.some((line) => line.includes('│ code')));
});

test('renderMarkdown: wrap dòng dài theo độ rộng', () => {
  const lines = renderMarkdown('từ '.repeat(40), 30);
  for (const line of lines) {
    const text = line.map((segment) => segment.text).join('');
    assert.ok(text.length <= 30, `dòng quá dài: ${text.length}`);
  }
});
