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

test('reduceInput: Ctrl+P và Ctrl+N đi lịch sử như ↑/↓', () => {
  const history = ['lệnh một', 'lệnh hai'];
  const up = reduceInput({ value: '', cursor: 0, historyIndex: -1 }, 'p', { ...EMPTY_KEY, ctrl: true }, history);
  assert.equal(up.state.value, 'lệnh hai');
  const down = reduceInput(up.state, 'n', { ...EMPTY_KEY, ctrl: true }, history);
  assert.equal(down.state.value, '', 'về lại draft rỗng');
});

test('reduceInput: Ctrl+P di chuyển con trỏ khi đang soạn nhiều dòng', () => {
  const value = 'dòng một\ndòng hai';
  const cursor = value.indexOf('hai') + 3;
  const moved = reduceInput({ value, cursor, historyIndex: -1 }, 'p', { ...EMPTY_KEY, ctrl: true }, ['x']);
  assert.equal(moved.state.value, value, 'không được đổi sang lịch sử');
  assert.equal(moved.state.cursor, 8, 'giữ cột cuối dòng đầu');
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

test('renderMarkdown: wrap không tách đôi cặp surrogate', () => {
  const source = `x${'😀'.repeat(12)}`;
  const lines = renderMarkdown(source, 10);
  const plain = lines.map((segments) => segments.map((segment) => segment.text).join(''));
  assert.ok(plain.length > 1, 'phải wrap thành nhiều dòng');
  for (const line of plain) {
    for (const char of line) {
      const code = char.codePointAt(0)!;
      assert.ok(code < 0xd800 || code > 0xdfff, `surrogate lẻ trong "${line}"`);
    }
    assert.ok([...line].length <= 10, `dòng quá dài: ${[...line].length}`);
  }
  assert.equal(plain.join(''), source, 'không được mất ký tự');
});

test('renderMarkdown: bảng markdown thành khung box-drawing', () => {
  const lines = renderMarkdown('| Tên | Tuổi |\n|---|---|\n| An | 30 |\n| Bình | 25 |', 60);
  const plain = lines.map((segments) => segments.map((segment) => segment.text).join(''));
  assert.ok(plain[0]!.startsWith('┌'), `thiếu viền trên: ${plain[0]}`);
  assert.ok(plain[0]!.includes('┬'), 'thiếu nút giao trên');
  assert.ok(plain.some((line) => line.includes('Tên') && line.includes('│')));
  assert.ok(plain.some((line) => line.includes('An') && line.includes('30')));
  assert.ok(plain.some((line) => line.includes('Bình') && line.includes('25')));
  assert.ok(plain.at(-1)!.startsWith('└'), 'thiếu viền dưới');
});

test('renderMarkdown: bảng căn lề theo dòng phân cách', () => {
  const lines = renderMarkdown('| Trái | Phải |\n|:---|--:|\n| a | b |', 60);
  const plain = lines.map((segments) => segments.map((s) => s.text).join(''));
  const body = plain.find((line) => line.includes('a') && line.includes('b'))!;
  // Cột phải căn phải: ký tự b nằm sát lề phải của ô
  assert.ok(/b \│$/.test(body), `căn phải sai: ${body}`);
});

test('renderMarkdown: bảng thu hẹp khi hẹp màn hình', () => {
  const wide = '| Cột một rất dài | Cột hai cũng rất dài |\n|---|---|\n| giá trị dài | giá trị dài khác |';
  for (const width of [40, 30, 20]) {
    const lines = renderMarkdown(wide, width);
    for (const line of lines) {
      const text = line.map((segment) => segment.text).join('');
      assert.ok(text.length <= width + 2, `width=${width} vượt: ${text.length}`);
    }
  }
});

test('renderMarkdown: không nhầm dòng có | thường thành bảng', () => {
  const lines = renderMarkdown('a | b không phải bảng', 60);
  const plain = lines.map((segments) => segments.map((s) => s.text).join(''));
  assert.ok(!plain.some((line) => line.startsWith('┌')), 'nhận nhầm thành bảng');
});
