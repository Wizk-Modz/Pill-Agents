// Đọc cấu hình từ settings.json trong thư mục cấu hình, rồi đến biến môi trường.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentMode } from './types.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_LEVELS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const AGENT_MODES: AgentMode[] = ['build', 'plan'];

export type Config = {
  apiKey: string;
  baseUrl: string;
  model: string;
  cwd: string;
  maxSteps?: number;
  configDir: string;
  effort?: Effort;
  mode: AgentMode;
  statusLine?: StatusLineConfig;
};

export type StatusLineConfig = {
  type?: 'command';
  command: string;
};

// Đọc số bước tối đa; báo lỗi nếu không phải số nguyên dương.
export function parseMaxSteps(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`PILL_MAX_STEPS phải là số nguyên dương; nhận được "${value}".`);
  }
  return parsed;
}

// Kiểm tra chuỗi có phải mức effort hợp lệ.
export function parseEffort(value: string | undefined): Effort | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return (EFFORT_LEVELS as string[]).includes(normalized) ? (normalized as Effort) : undefined;
}

// Kiểm tra giá trị có phải chế độ agent hợp lệ.
export function parseMode(value: unknown): AgentMode | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const normalized = value.trim().toLowerCase();
  return (AGENT_MODES as string[]).includes(normalized) ? (normalized as AgentMode) : undefined;
}

// Đọc mục statusLine; chỉ nhận type "command" kèm lệnh không rỗng, bỏ qua phần còn lại.
export function parseStatusLine(value: unknown): StatusLineConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== undefined && record.type !== 'command') return undefined;
  const command = typeof record.command === 'string' ? record.command.trim() : '';
  if (!command) return undefined;
  return record.type === 'command' ? { type: 'command', command } : { command };
}

type Settings = {
  env?: Record<string, string>;
  model?: string;
  mode?: unknown;
  statusLine?: unknown;
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
    maxSteps: parseMaxSteps(pick('PILL_MAX_STEPS')),
    configDir: dir,
    effort: parseEffort(pick('PILL_EFFORT')),
    mode: parseMode(pick('PILL_MODE')) ?? parseMode(settings.mode) ?? 'build',
    statusLine: parseStatusLine(settings.statusLine),
  };
}
