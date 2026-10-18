// Kiểm thử system prompt mà agent gửi cho model.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { buildSystemPrompt } from '../src/agent.js';

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
  for (const name of ['read_file', 'write_file', 'edit_file', 'bash', 'grep', 'glob']) {
    assert.ok(prompt.includes(name), `thiếu tool ${name}`);
  }
});

test('buildSystemPrompt có đủ các mục chính', () => {
  const prompt = buildSystemPrompt('/du-an/mau');
  for (const heading of ['## Môi trường', '## Cách làm việc', '## Tool đang có', '## Viết code', '## Trả lời']) {
    assert.ok(prompt.includes(heading), `thiếu mục ${heading}`);
  }
});
