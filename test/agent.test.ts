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
