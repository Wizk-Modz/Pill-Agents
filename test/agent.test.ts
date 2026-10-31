// Kiểm thử system prompt mà agent gửi cho model.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { buildSystemPrompt, toolsForMode } from '../src/agent.js';
import { createTools } from '../src/tools.js';
import {
  buildEnvironmentSection,
  buildPlanSection,
  buildToolSection,
  composePrompt,
} from '../src/prompt.js';

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

test('prompt nêu nền tảng, shell và git repo theo ngữ cảnh', () => {
  const withGit = composePrompt('build', { cwd: '/du-an/mau', platform: 'linux', isGitRepo: true });
  assert.match(withGit, /Nền tảng: Linux/);
  assert.ok(withGit.includes('/bin/sh -c'));
  assert.ok(withGit.includes('Đây là git repo'));
  assert.ok(!withGit.includes('không phải git repo'));

  const noGit = composePrompt('build', { cwd: '/du-an/mau', platform: 'win32', isGitRepo: false });
  assert.match(noGit, /Nền tảng: Windows/);
  assert.ok(noGit.includes('cmd.exe /d /s /c'));
  assert.ok(noGit.includes('không phải git repo'));
  assert.ok(noGit.includes('đừng giả định có lịch sử commit'));
});

test('prompt nêu thư mục làm việc và nhắc đường dẫn tuyệt đối', () => {
  const prompt = composePrompt('build', { cwd: '/du-an/mau', isGitRepo: true });
  assert.ok(prompt.includes('Thư mục làm việc: /du-an/mau'));
  assert.ok(prompt.includes('Đường dẫn trong tool phải tuyệt đối'));
});

test('prompt build có mục con hướng dẫn chọn tool, đọc sửa file và kiểm chứng', () => {
  const prompt = composePrompt('build', { cwd: '/du-an/mau', isGitRepo: true });
  for (const heading of ['### Chọn tool', '### Đọc và sửa file', '### Kiểm chứng']) {
    assert.ok(prompt.includes(heading), `thiếu mục ${heading}`);
  }
  assert.ok(prompt.includes('Glob để định vị file theo tên'));
  assert.ok(prompt.includes('không sửa test cho qua'), 'phải dặn không sửa test cho qua');
});

test('prompt plan không có mục con của build nhưng có mục Chế độ plan', () => {
  const plan = composePrompt('plan', { cwd: '/du-an/mau', isGitRepo: true });
  assert.ok(!plan.includes('### Chọn tool'));
  assert.ok(plan.includes('## Chế độ plan'));
  assert.equal(buildPlanSection('build').length, 0);
  assert.ok(buildPlanSection('plan').length > 0);
});

test('các mục prompt tách rời ghép lại thành prompt hoàn chỉnh', () => {
  const parts = [
    ...buildEnvironmentSection({ cwd: '/x', isGitRepo: true }),
    ...buildToolSection('build'),
  ].join('\n');
  assert.ok(parts.includes('## Môi trường'));
  assert.ok(parts.includes('## Tool đang có'));
  assert.ok(!parts.includes('## Cách làm việc'), 'không tự thêm mục khác');
});

test('buildSystemPrompt phát hiện đúng thư mục không phải git repo', () => {
  // Thư mục tạm của hệ thống không có .git nên prompt phải nói rõ.
  const prompt = buildSystemPrompt(tmpdir());
  assert.ok(prompt.includes('không phải git repo'));
});
