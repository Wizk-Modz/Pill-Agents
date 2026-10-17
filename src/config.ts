// Đọc cấu hình từ settings.json trong thư mục cấu hình, rồi đến biến môi trường.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type Config = {
  apiKey: string;
  baseUrl: string;
  model: string;
  cwd: string;
  maxSteps: number;
  configDir: string;
};

type Settings = {
  env?: Record<string, string>;
  model?: string;
};

// Xác định thư mục cấu hình theo hệ điều hành, tôn trọng biến ghi đè.
export function configDir(): string {
  if (process.env.PILL_CONFIG_DIR) return process.env.PILL_CONFIG_DIR;
  // homedir() tự đúng trên Linux, macOS, Windows và Termux.
  return path.join(homedir(), '.pill');
}

// Đọc settings.json, trả object rỗng nếu chưa có hoặc không hợp lệ.
export function loadSettings(dir: string = configDir()): Settings {
  try {
    const raw = readFileSync(path.join(dir, 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as Settings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Tạo cấu hình, báo lỗi rõ ràng khi thiếu API key.
export function loadConfig(cwd: string = process.cwd()): Config {
  const dir = configDir();
  const settings = loadSettings(dir);
  const fromSettings = settings.env ?? {};

  // Thứ tự ưu tiên: biến môi trường > settings.json > giá trị mặc định.
  const pick = (envKey: string): string | undefined => process.env[envKey] || fromSettings[envKey];
  const apiKey = pick('PILL_API_KEY') || pick('OPENAI_API_KEY') || '';
  if (!apiKey) {
    throw new Error(
      `Thiếu API key. Đặt trong ${path.join(dir, 'settings.json')} (mục "env") hoặc biến môi trường PILL_API_KEY.`,
    );
  }
  return {
    apiKey,
    baseUrl: pick('PILL_BASE_URL') || 'https://api.openai.com/v1',
    model: pick('PILL_MODEL') || settings.model || 'gpt-4o-mini',
    cwd,
    maxSteps: Number(pick('PILL_MAX_STEPS')) || 25,
    configDir: dir,
  };
}
