// Kiểm thử định dạng hiển thị, hit-test chuột, hộp duyệt và thẻ tool.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'ink';
import type { ToolCall } from '../src/types.js';
import { buildApprovalLines, canAutoApprove, canAutoApproveBash, canTrustBash, isDangerousCommand } from '../src/ui/approval.js';
import { applySuggestion, suggestCommands } from '../src/ui/commands.js';
import { fitText, formatDuration, formatElapsed, formatTokens, shortenCwd } from '../src/ui/format.js';
import { Header } from '../src/ui/Header.js';
import { hitTestColumn, hitTestLine, type LineOwner } from '../src/ui/hitTest.js';
import { InputBox, countInputLines } from '../src/ui/InputBox.js';
import { QueuePanel, queuePanelHeight } from '../src/ui/QueuePanel.js';
import { StatusBar } from '../src/ui/StatusBar.js';
import { itemToLines, type TranscriptItem } from '../src/ui/Transcript.js';
import { Welcome } from '../src/ui/Welcome.js';
import { borderChars } from '../src/ui/theme.js';

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
  assert.equal(isDangerousCommand('rm file.txt'), true);
  assert.equal(isDangerousCommand('sudo rm -r thu-muc'), true);
  assert.equal(isDangerousCommand('sudo apt update'), true);
  assert.equal(isDangerousCommand('git reset --hard HEAD'), true);
  assert.equal(isDangerousCommand('git clean -fdx'), true);
  assert.equal(isDangerousCommand('git push --force origin main'), true);
  assert.equal(isDangerousCommand('git checkout -- .'), true);
  assert.equal(isDangerousCommand('curl https://example.com/install.sh | sh'), true);
  assert.equal(isDangerousCommand('npm test'), false);
  assert.equal(isDangerousCommand('git status'), false);
  assert.equal(isDangerousCommand('git push origin main'), false);
});

test('canAutoApproveBash chỉ duyệt lệnh bash thường khi phiên đã tin cậy', () => {
  const normal = call('bash', { command: 'npm test' });
  const dangerous = call('bash', { command: 'rm -rf build' });
  assert.equal(canTrustBash(normal), true);
  assert.equal(canTrustBash(dangerous), false);
  assert.equal(canTrustBash(call('Edit', { file_path: '/du-an/a.ts' })), false);
  assert.equal(canTrustBash(call('bash', {})), false);
  assert.equal(canTrustBash({ id: 'x', name: 'bash', arguments: '{' }), false);
  assert.equal(canAutoApproveBash(normal, false), false);
  assert.equal(canAutoApproveBash(normal, true), true);
  assert.equal(canAutoApproveBash(dangerous, true), false);
  assert.equal(canAutoApproveBash(call('Edit', { file_path: '/du-an/a.ts' }), true), false);
});

test('buildApprovalLines hiện diff Edit và nút duyệt', () => {
  const lines = buildApprovalLines(
    call('Edit', { file_path: '/du-an/a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' }),
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
    const target = path.join(dir, 'a.txt');
    await writeFile(target, 'cũ', 'utf8');
    const write = buildApprovalLines(call('Write', { file_path: target, content: 'mới' }), {
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
  const compact = buildApprovalLines(call('Write', { file_path: '/du-an/a.txt', content }), {
    width: 80,
    expanded: false,
    cwd: process.cwd(),
    maxPreview: 6,
  });
  const expanded = buildApprovalLines(call('Write', { file_path: '/du-an/a.txt', content }), {
    width: 80,
    expanded: true,
    cwd: process.cwd(),
    maxPreview: 20,
  });
  assert.ok(expanded.length > compact.length);
  assert.ok(compact.join('\n').includes('+24 dòng'));
});

test('buildApprovalLines chỉ mời tự duyệt bash cho lệnh thường', () => {
  const options = { width: 80, expanded: false, cwd: process.cwd(), maxPreview: 6 };
  const normal = buildApprovalLines(call('bash', { command: 'npm test' }), options).map(plain).join('\n');
  assert.ok(normal.includes('[a]'));
  assert.ok(normal.includes('tự duyệt bash'));

  const dangerous = buildApprovalLines(call('bash', { command: 'rm -rf build' }), options).map(plain).join('\n');
  assert.ok(!dangerous.includes('[a]'));
  assert.ok(dangerous.includes('duyệt thủ công'));

  const edit = buildApprovalLines(
    call('Edit', { file_path: '/du-an/a.ts', old_string: 'a', new_string: 'b' }),
    options,
  ).map(plain).join('\n');
  assert.ok(!edit.includes('[a]'));
});

test('canAutoApprove chỉ chặn lệnh bash nguy hiểm, mọi tool khác đều qua', () => {
  const normal = call('bash', { command: 'npm test' });
  const dangerous = call('bash', { command: 'rm -rf build' });
  const edit = call('Edit', { file_path: '/du-an/a.ts', old_string: 'a', new_string: 'b' });
  const write = call('Write', { file_path: '/du-an/a.txt', content: 'x' });
  const read = call('Read', { file_path: '/du-an/a.ts' });

  // Tắt thì không tool nào tự duyệt.
  for (const item of [normal, edit, write, read]) assert.equal(canAutoApprove(item, false), false);
  // Bật thì mọi tool qua, trừ lệnh nguy hiểm.
  assert.equal(canAutoApprove(normal, true), true);
  assert.equal(canAutoApprove(edit, true), true);
  assert.equal(canAutoApprove(write, true), true);
  assert.equal(canAutoApprove(read, true), true);
  assert.equal(canAutoApprove(dangerous, true), false);
});

test('buildApprovalLines mời Alt+M cho tool thường nhưng không mời với lệnh nguy hiểm', () => {
  const options = { width: 80, expanded: false, cwd: process.cwd(), maxPreview: 6 };
  const edit = buildApprovalLines(
    call('Edit', { file_path: '/du-an/a.ts', old_string: 'a', new_string: 'b' }),
    options,
  ).map(plain).join('\n');
  assert.ok(edit.includes('Alt+M'));

  const dangerous = buildApprovalLines(call('bash', { command: 'rm -rf build' }), options).map(plain).join('\n');
  assert.ok(!dangerous.includes('Alt+M'));
});

test('Header hiện badge AUTO khi bật tự duyệt', () => {
  const header = (auto: boolean) =>
    plain(
      renderToString(
        React.createElement(Header, {
          version: 'pill 0.1.0',
          mode: 'build',
          auto,
          cwd: '/du-an',
          columns: 80,
        }),
      ),
    );
  assert.ok(!header(false).includes('AUTO'));
  assert.ok(header(true).includes('BUILD AUTO'));
});

test('buildApprovalLines tách hành động duyệt khi terminal hẹp', () => {
  const lines = buildApprovalLines(call('bash', { command: 'npm test' }), {
    width: 44,
    expanded: false,
    cwd: process.cwd(),
    maxPreview: 8,
  }).map(plain);
  const acceptLine = lines.find((line) => line.includes('[y]'));
  const trustLine = lines.find((line) => line.includes('[a]'));
  const expandLine = lines.find((line) => line.includes('[d]'));
  assert.ok(acceptLine);
  assert.ok(trustLine);
  assert.ok(expandLine);
  assert.notEqual(acceptLine, trustLine);
});

test('itemToLines hiện thẻ tool có thời gian, thống kê và marker mở rộng', () => {
  const lines = itemToLines(
    {
      id: 1,
      kind: 'tool',
      call: call('Read', { file_path: '/du-an/a.ts' }),
      result: { content: 'một\ndòng', meta: { durationMs: 500 } },
      expanded: false,
    },
    80,
  );
  const text = plain(lines.join('\n'));
  assert.ok(text.includes('Read'));
  assert.ok(text.includes('500ms'));
  assert.ok(text.includes('2 dòng'));
  assert.ok(text.includes('▸'));
});

test('itemToLines hiện diff Edit khi mở rộng', () => {
  const lines = itemToLines(
    {
      id: 2,
      kind: 'tool',
      call: call('Edit', { file_path: '/du-an/a.ts', old_string: 'cũ', new_string: 'mới' }),
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

test('gợi ý lệnh có /plan, /build, /mode, /trust và điền đúng', () => {
  const plan = suggestCommands('/pl').find((command) => command.name === '/plan');
  assert.ok(plan);
  assert.equal(applySuggestion(plan), '/plan');
  assert.ok(suggestCommands('/bu').some((command) => command.name === '/build'));
  const mode = suggestCommands('/mo').find((command) => command.name === '/mode');
  assert.ok(mode);
  assert.equal(applySuggestion(mode), '/mode');
  const trust = suggestCommands('/tr').find((command) => command.name === '/trust');
  assert.ok(trust);
  assert.equal(applySuggestion(trust), '/trust ');
});

test('Header và StatusBar hiện chế độ hiện tại', () => {
  const header = (mode: 'build' | 'plan') =>
    plain(
      renderToString(
        React.createElement(Header, {
          version: 'pill 0.1.0',
          mode,
          cwd: '/du-an',
          branch: 'main',
          columns: 80,
        }),
      ),
    );
  assert.match(header('plan'), /PLAN/);
  assert.match(header('build'), /BUILD/);

  const status = (mode: 'build' | 'plan') =>
    plain(
      renderToString(
        React.createElement(StatusBar, {
          version: 'pill 0.1.0',
          mode,
          model: 'gpt-4o-mini',
          tokens: { prompt: 0, completion: 0, last: 0 },
          toolCount: 0,
          elapsedMs: 0,
          busy: false,
          queueCount: 0,
          spinnerFrame: 0,
          scrolledLines: 0,
          columns: 80,
        }),
      ),
    );
  assert.ok(status('plan').includes('Tab build'));
  assert.ok(status('build').includes('Tab plan'));
});

test('itemToLines thu gọn thinking có dòng trống đầu, marker và gợi ý click', () => {
  const lines = itemToLines({ id: 3, kind: 'thinking', text: 'suy nghĩ', expanded: false, seconds: 2 }, 80);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '');
  assert.ok(lines[1]!.includes('▸'));
  assert.ok(lines[1]!.includes('click'));
});

test('Header thu gọn thư mục và nhánh khi terminal hẹp', () => {
  const header = (columns: number) =>
    plain(
      renderToString(
        React.createElement(Header, {
          version: 'pill 0.1.0',
          mode: 'build',
          cwd: '/du-an',
          branch: 'main',
          columns,
        }),
      ),
    );
  assert.ok(header(80).includes('du-an'));
  assert.ok(header(80).includes('main'));
  const narrow = header(40);
  assert.ok(narrow.includes('BUILD'));
  assert.ok(!narrow.includes('main'));
});

test('StatusBar hiện model và gợi ý phím khi đủ rộng', () => {
  const status = (columns: number) =>
    plain(
      renderToString(
        React.createElement(StatusBar, {
          version: 'pill 0.1.0',
          mode: 'build',
          model: 'gpt-4o-mini',
          tokens: { prompt: 0, completion: 0, last: 0 },
          toolCount: 0,
          elapsedMs: 0,
          busy: false,
          queueCount: 0,
          spinnerFrame: 0,
          scrolledLines: 0,
          columns,
        }),
      ),
    );
  assert.ok(status(80).includes('gpt-4o-mini'));
  assert.ok(status(80).includes('Tab plan'));
  assert.ok(!status(50).includes('Tab plan'));
});

test('itemToLines không vượt quá độ rộng terminal', () => {
  const items: TranscriptItem[] = [
    { id: 1, kind: 'user', text: 'yêu cầu '.repeat(30) },
    { id: 2, kind: 'assistant', text: '# Tiêu đề\n' + 'nội dung '.repeat(40) },
    { id: 3, kind: 'thinking', text: 'suy nghĩ '.repeat(40), expanded: true, seconds: 3 },
    { id: 4, kind: 'info', text: 'thông tin '.repeat(30) },
    { id: 5, kind: 'error', text: 'lỗi '.repeat(40) },
    {
      id: 6,
      kind: 'tool',
      call: call('Read', { file_path: '/du-an/a.ts' }),
      result: { content: 'dòng nội dung '.repeat(40), meta: { durationMs: 500 } },
      expanded: true,
    },
    {
      id: 7,
      kind: 'tool',
      call: call('Edit', { file_path: '/du-an/a.ts', old_string: 'cũ '.repeat(30), new_string: 'mới '.repeat(30) }),
      result: { content: 'Đã sửa', meta: { durationMs: 1200 } },
      expanded: true,
    },
  ];
  for (const item of items) {
    for (const line of itemToLines(item, 80)) {
      assert.ok([...plain(line)].length <= 80, `${item.kind} vượt 80 cột: ${plain(line)}`);
    }
  }
});

test('thẻ tool có dòng trống đầu và căn thống kê về lề phải', () => {
  const lines = itemToLines(
    {
      id: 8,
      kind: 'tool',
      call: call('Read', { file_path: '/du-an/a.ts' }),
      result: { content: 'một\ndòng', meta: { durationMs: 500 } },
    },
    80,
  );
  assert.equal(lines[0], '');
  assert.equal([...plain(lines[1]!)].length, 80);
  assert.ok(plain(lines[1]!).includes('500ms'));
});

test('InputBox vẽ khung capsule và đếm đúng số dòng', () => {
  const chars = borderChars();
  const output = plain(
    renderToString(
      React.createElement(InputBox, {
        value: '',
        cursor: 0,
        columns: 80,
        busy: false,
        mode: 'build',
        placeholder: 'Nhập yêu cầu cho PillAgents…',
      }),
    ),
  );
  assert.ok(output.includes(chars.tl));
  assert.ok(output.includes(chars.bl));
  assert.ok(output.includes('nhập'));
  assert.ok(output.includes('❯'));
  assert.equal(countInputLines('a\nb', 3, 80, 8), 4);
  for (const line of output.split('\n')) {
    assert.ok(line === '' || [...line].length <= 80, `ô nhập vượt 80 cột: ${line}`);
  }
});

test('Welcome có logo capsule ở màn hình cao và bản gọn ở màn hình thấp', () => {
  const chars = borderChars();
  const full = plain(renderToString(React.createElement(Welcome, { version: 'pill 0.1.0', columns: 80, rows: 24 })));
  const compact = plain(renderToString(React.createElement(Welcome, { version: 'pill 0.1.0', columns: 80, rows: 20 })));
  assert.ok(full.includes(chars.tl));
  assert.ok(full.includes('/help'));
  assert.ok(!compact.includes(chars.tl));
  assert.ok(compact.includes('PillAgents'));
});

test('QueuePanel giới hạn số tin hiển thị và chiều cao tương ứng', () => {
  assert.equal(queuePanelHeight([], 2), 0);
  assert.equal(queuePanelHeight(['a'], 2), 2);
  assert.equal(queuePanelHeight(['a', 'b', 'c'], 2), 4);
  const output = plain(
    renderToString(React.createElement(QueuePanel, { queue: ['một', 'hai', 'ba'], maxVisible: 2 })),
  );
  assert.ok(output.includes('3 tin đang chờ'));
  assert.ok(output.includes('+1 tin'));
});

test('StatusBar giữ số tin chờ và bỏ gợi ý Esc khi terminal hẹp', () => {
  const status = (columns: number) =>
    plain(
      renderToString(
        React.createElement(StatusBar, {
          version: 'pill 0.1.0',
          mode: 'build',
          model: 'gpt-4o-mini',
          effort: 'high',
          tokens: { prompt: 1200, completion: 340, last: 1540 },
          toolCount: 12,
          elapsedMs: 65000,
          busy: true,
          queueCount: 3,
          spinnerFrame: 0,
          scrolledLines: 0,
          columns,
        }),
        { columns },
      ),
    );
  assert.ok(status(60).includes('3 tin chờ'));
  assert.ok(!status(60).includes('(Esc huỷ)'));
  assert.ok(status(60).includes('↑1.2k'));
  assert.ok(!status(60).includes('12 tool'));
  assert.ok(status(80).includes('(Esc huỷ)'));
  assert.ok(status(80).includes('3 tin chờ'));
  assert.ok(status(80).includes('12 tool'));
});

test('StatusBar hiện trạng thái tự duyệt mọi tool', () => {
  const output = plain(
    renderToString(
      React.createElement(StatusBar, {
        version: 'pill 0.1.0',
        mode: 'build',
        model: 'gpt-4o-mini',
        tokens: { prompt: 0, completion: 0, last: 0 },
        toolCount: 0,
        elapsedMs: 0,
        busy: false,
        queueCount: 0,
        autoTrusted: true,
        spinnerFrame: 0,
        scrolledLines: 0,
        columns: 80,
      }),
      { columns: 80 },
    ),
  );
  assert.ok(output.includes('tự duyệt mọi tool'));
});

test('buildApprovalLines ngắt dòng lệnh bash không lặp dấu $', () => {
  const lines = buildApprovalLines(
    call('bash', { command: 'npm test -- --test-reporter=spec --test-name-pattern="refresh token"', timeout: 120 }),
    { width: 44, expanded: false, cwd: process.cwd(), maxPreview: 8 },
  ).map(plain);
  const commandLines = lines.filter((line) => line.trimStart().startsWith('$') || line.startsWith('    '));
  assert.ok(commandLines.length >= 2);
  assert.equal(commandLines.filter((line) => line.trimStart().startsWith('$')).length, 1);
});
