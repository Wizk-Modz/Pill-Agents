// Kiểm thử system prompt mà agent gửi cho model.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { buildSystemPrompt, toolsForMode } from '../src/agent.js';
import { createTools } from '../src/tools.js';

test('buildSystemPrompt nêu thư mục làm việc', () => {
  const prompt = buildSystemPrompt('/du-an/mau');
  assert.match(prompt, /\/du-an\/mau/);
});

test('buildSystemPrompt nêu thư mục tạm thật của máy thay vì mặc định /tmp', () => {
  const prompt = buildSystemPrompt('/du-an/mau');
  assert.ok(prompt.includes(tmpdir()), 'thiếu thư mục tạm của máy');
  assert.match(prompt, /\$TMPDIR/);
});

test('buildSystemPrompt liệt kê đủ 6 tool', () => {
  const prompt = buildSystemPrompt('/du-an/mau');
  for (const name of ['Read', 'Write', 'Edit', 'bash', 'grep', 'Glob']) {
    assert.ok(prompt.includes(name), `thiếu tool ${name}`);
  }
});

test('buildSystemPrompt có đủ các mục chính', () => {
  const prompt = buildSystemPrompt('/du-an/mau');
  for (const heading of ['## Môi trường', '## Cách làm việc', '## Tool đang có', '## Viết code', '## Trả lời']) {
    assert.ok(prompt.includes(heading), `thiếu mục ${heading}`);
  }
});

test('buildSystemPrompt ở chế độ plan nêu rõ chỉ đọc và cách lập kế hoạch', () => {
  const prompt = buildSystemPrompt('/du-an/mau', 'plan');
  assert.match(prompt, /chế độ plan \(chỉ đọc\)/);
  assert.ok(prompt.includes('## Chế độ plan'));
  assert.ok(prompt.includes('Write, Edit, bash bị khoá'));
  assert.ok(prompt.includes('## Trả lời'), 'vẫn giữ quy tắc trả lời');
  assert.ok(!prompt.includes('Write, Edit, bash: cần người dùng duyệt'));
});

test('buildSystemPrompt mặc định là build, không có mục plan', () => {
  const prompt = buildSystemPrompt('/du-an/mau');
  assert.ok(prompt.includes('Write, Edit, bash: cần người dùng duyệt'));
  assert.ok(!prompt.includes('## Chế độ plan'));
});

test('toolsForMode chỉ giữ tool đọc ở chế độ plan', () => {
  const tools = createTools('/du-an/mau');
  assert.deepEqual(
    toolsForMode(tools, 'plan').map((tool) => tool.name),
    ['Read', 'grep', 'Glob'],
  );
  assert.deepEqual(
    toolsForMode(tools, 'build').map((tool) => tool.name),
    ['Read', 'Write', 'Edit', 'bash', 'grep', 'Glob'],
  );
});
