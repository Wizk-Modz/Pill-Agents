// Kiểm thử bộ parse phím thô và render markdown.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInput } from '../src/ui/useKeys.js';
import { renderMarkdown, paint } from '../src/ui/markdown.js';
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
  const shifted = firstKey('\x1b[<68;10;5M');
  assert.ok(shifted.type === 'wheel' && shifted.direction === 'up', 'giữ modifier không làm mất lăn chuột');
});

test('parseInput nhận diện click chuột trái và bỏ qua release, kéo, shift+click', () => {
  const click = firstKey('\x1b[<0;12;5M');
  assert.equal(click.type, 'click');
  assert.ok(click.type === 'click' && click.column === 12 && click.row === 5);

  const release = parseInput('\x1b[<0;12;5m', false);
  assert.equal(release.events.length, 0, 'release không phải click');

  const drag = parseInput('\x1b[<32;12;5M', false);
  assert.equal(drag.events.length, 0, 'kéo chuột không phải click');

  const shiftClick = parseInput('\x1b[<4;12;5M', false);
  assert.equal(shiftClick.events.length, 0, 'shift+click dành cho chọn văn bản');

  const rightClick = parseInput('\x1b[<2;12;5M', false);
  assert.equal(rightClick.events.length, 0, 'chỉ nhận chuột trái');
});

test('parseInput chờ đủ chuỗi click bị tách', () => {
  const first = parseInput('\x1b[<0;12', false);
  assert.equal(first.events.length, 0);
  assert.equal(first.rest, '\x1b[<0;12');
  const second = parseInput(`${first.rest};5M`, false);
  assert.equal(second.events.length, 1);
  assert.ok(second.events[0]!.type === 'click');
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

test('spinner dùng toàn khung hình braille và có U+283C', async () => {
  const { SPINNER_FRAMES } = await import('../src/ui/format.js');
  assert.ok(SPINNER_FRAMES.includes('\u283c'), 'thiếu U+283C');
  const codes = SPINNER_FRAMES.map((frame: string) => frame.codePointAt(0) ?? 0);
  assert.ok(
    codes.every((code: number) => code >= 0x2800 && code <= 0x28ff),
    'có khung hình nằm ngoài dải braille',
  );
});

test('renderMarkdown: đậm nghiêng *** và gạch ngang ~~', () => {
  const segments = renderMarkdown('***đậm nghiêng*** và ~~gạch ngang~~', 80).flat();
  const styled = (keep: (segment: { bold?: boolean; italic?: boolean; strike?: boolean }) => boolean) =>
    segments.filter(keep).map((segment) => segment.text).join('');
  assert.equal(styled((segment) => Boolean(segment.bold && segment.italic)), 'đậm nghiêng');
  assert.equal(styled((segment) => Boolean(segment.strike)), 'gạch ngang');
  assert.ok(!segments.some((segment) => /[*~]/.test(segment.text)), 'còn sót dấu markdown');
  assert.equal(paint({ text: 'x', strike: true }), '\x1b[9mx\x1b[0m');
});

test('renderMarkdown: dấu nhấn sát khoảng trắng và gạch dưới trong từ được giữ nguyên', () => {
  const plain = (text: string) => renderMarkdown(text, 80).flat().map((segment) => segment.text).join('');
  assert.equal(plain('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(plain('snake_case_name và PILL_MAX_STEPS'), 'snake_case_name và PILL_MAX_STEPS');
  assert.ok(renderMarkdown('**đậm **', 80).flat().every((segment) => !segment.bold), 'vẫn nhận là đậm');
});

test('renderMarkdown: dòng trộn code, đậm, nghiêng, đậm nghiêng, gạch ngang', () => {
  const segments = renderMarkdown(
    'Fix `docs/` và **Đậm**, *nghiêng*, ***đậm nghiêng***, ~~gạch ngang~~',
    100,
  ).flat();
  const styled = (keep: (segment: { bold?: boolean; italic?: boolean; strike?: boolean; color?: string }) => boolean) =>
    segments.filter(keep).map((segment) => segment.text).join('');
  assert.equal(styled((segment) => segment.color === 'yellow'), 'docs/');
  assert.equal(styled((segment) => Boolean(segment.bold && !segment.italic)), 'Đậm');
  assert.equal(styled((segment) => Boolean(segment.italic && !segment.bold)), 'nghiêng');
  assert.equal(styled((segment) => Boolean(segment.bold && segment.italic)), 'đậm nghiêng');
  assert.equal(styled((segment) => Boolean(segment.strike)), 'gạch ngang');
});

test('renderMarkdown: khối code không tô màu, giữ thụt lề và cắt dòng dài', () => {
  const long = `console.log("${'x'.repeat(80)}");`;
  const lines = renderMarkdown(['```ts', '  const a = 1;', '', long, '```'].join('\n'), 40);
  const plain = lines.map((segments) => segments.map((segment) => segment.text).join(''));
  const content = lines.map((segments) => segments[1]!.text);
  assert.equal(content[0], '  const a = 1;', 'phải giữ thụt lề');
  assert.equal(content[1], '', 'phải giữ dòng trống trong khối code');
  assert.ok(content.length > 3, 'dòng dài phải bị cắt thành nhiều dòng');
  assert.equal(content.slice(2).join(''), long, 'cắt dòng mà không được mất ký tự');
  for (let index = 0; index < lines.length; index++) {
    assert.equal(lines[index]![0]!.text, '│ ', 'mỗi dòng code mở đầu bằng vạch');
    assert.equal(lines[index]![0]!.color, 'gray');
    assert.equal(content[index]!.includes('\x1b'), false);
    assert.equal(lines[index]![1]!.color, undefined, 'nội dung code để màu mặc định');
    assert.ok([...plain[index]!].length <= 40, `dòng code vượt khung: ${plain[index]}`);
  }
});

test('renderMarkdown: tiêu đề H1 tới H6 mỗi cấp một style', () => {
  const styleKey = (segment: { color?: string; dim?: boolean; bold?: boolean; underline?: boolean }): string =>
    `${segment.bold ? 'b' : ''}${segment.dim ? 'd' : ''}${segment.underline ? 'u' : ''}${segment.color ?? ''}`;
  const signatures = [1, 2, 3, 4, 5, 6].map((level) => {
    const line = renderMarkdown(`${'#'.repeat(level)} Cấp ${level}`, 40)[0]!;
    assert.equal(line.map((segment) => segment.text).join(''), `Cấp ${level}`, 'bỏ dấu # nhưng giữ chữ');
    const keys = new Set(line.map(styleKey));
    assert.equal(keys.size, 1, `cấp ${level} phải dùng một style`);
    return [...keys][0];
  });
  assert.equal(new Set(signatures).size, 6, 'sáu cấp phải khác nhau');
  assert.equal(signatures[0], 'bucyan');
  assert.equal(signatures[1], 'bcyan');
  assert.equal(signatures[2], 'bblue');
  assert.equal(signatures[3], 'bwhite');
  assert.equal(signatures[4], 'bgray');
  assert.equal(signatures[5], 'dgray');
});

test('renderMarkdown: quote lồng nhau thêm vạch theo từng cấp', () => {
  const lines = renderMarkdown(
    ['> cấp một', '> > cấp hai', '>>cấp hai dính', '> > > cấp ba', '>', '> chữ **đậm**'].join('\n'),
    40,
  );
  const plain = lines.map((segments) => segments.map((segment) => segment.text).join(''));
  assert.equal(plain[0], '│ cấp một');
  assert.equal(plain[1], '│ │ cấp hai');
  assert.equal(plain[2], '│ │ cấp hai dính', 'dạng >> không có dấu cách vẫn tính là hai cấp');
  assert.equal(plain[3], '│ │ │ cấp ba');
  assert.equal(plain[4], '│', 'dòng quote trống vẫn hiện vạch');
  assert.equal(plain[5], '│ chữ đậm');
  assert.ok(lines[1]![0]!.dim, 'từ cấp hai trở đi vạch bị làm mờ');
  assert.ok(!lines[0]![0]!.dim, 'vạch cấp một không làm mờ');
  assert.ok(lines[5]!.some((segment) => segment.bold), 'quote vẫn parse markdown inline');

  for (const line of renderMarkdown(`> > ${'x'.repeat(50)}`, 20)) {
    const text = line.map((segment) => segment.text).join('');
    assert.equal(line[0]!.text, '│ │ ');
    assert.ok([...text].length <= 20, `dòng quote vượt khung: ${text}`);
  }
});
