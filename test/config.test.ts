// Kiểm thử đọc chế độ agent từ cấu hình.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig, parseMode } from '../src/config.js';

// Tạo thư mục tạm, chạy callback rồi dọn dẹp.
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pill-config-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Đặt các biến môi trường tạm thời và khôi phục sau khi chạy.
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Ghi settings.json vào thư mục cấu hình tạm.
async function writeSettings(dir: string, settings: unknown): Promise<void> {
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
}

test('parseMode nhận build/plan và bỏ khoảng trắng, không phân biệt hoa thường', () => {
  assert.equal(parseMode('build'), 'build');
  assert.equal(parseMode(' PLAN '), 'plan');
  assert.equal(parseMode('Build'), 'build');
});

test('parseMode trả undefined với giá trị trống, sai kiểu hoặc không hợp lệ', () => {
  assert.equal(parseMode(undefined), undefined);
  assert.equal(parseMode(''), undefined);
  assert.equal(parseMode(42), undefined);
  assert.equal(parseMode('review'), undefined);
});

test('loadConfig đọc mode từ settings và ưu tiên PILL_MODE', async () => {
  await withTempDir(async (dir) => {
    await withEnv({ PILL_CONFIG_DIR: dir, PILL_MODE: undefined, PILL_API_KEY: undefined }, async () => {
      await writeSettings(dir, { env: { PILL_API_KEY: 'test' }, mode: 'plan' });
      assert.equal(loadConfig(dir).mode, 'plan');

      await writeSettings(dir, { env: { PILL_API_KEY: 'test', PILL_MODE: 'plan' }, mode: 'build' });
      assert.equal(loadConfig(dir).mode, 'plan');

      process.env.PILL_MODE = 'build';
      assert.equal(loadConfig(dir).mode, 'build');
    });
  });
});

test('loadConfig bỏ mode không hợp lệ và dùng giá trị kế tiếp', async () => {
  await withTempDir(async (dir) => {
    await withEnv({ PILL_CONFIG_DIR: dir, PILL_MODE: 'review', PILL_API_KEY: undefined }, async () => {
      await writeSettings(dir, { env: { PILL_API_KEY: 'test' }, mode: 'plan' });
      assert.equal(loadConfig(dir).mode, 'plan');

      delete process.env.PILL_MODE;
      await writeSettings(dir, { env: { PILL_API_KEY: 'test', PILL_MODE: 'không-hợp-lệ' }, mode: 'plan' });
      assert.equal(loadConfig(dir).mode, 'plan');

      await writeSettings(dir, { env: { PILL_API_KEY: 'test' }, mode: 'review' });
      assert.equal(loadConfig(dir).mode, 'build');
    });
  });
});
