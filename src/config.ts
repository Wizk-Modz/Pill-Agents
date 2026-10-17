// Đọc cấu hình từ biến môi trường.
export type Config = {
  apiKey: string;
  baseUrl: string;
  model: string;
  cwd: string;
  maxSteps: number;
};

// Tạo cấu hình, báo lỗi rõ ràng khi thiếu API key.
export function loadConfig(cwd: string = process.cwd()): Config {
  const apiKey = process.env.PILL_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      'Thiếu API key. Đặt PILL_API_KEY (hoặc OPENAI_API_KEY) trong .env hoặc biến môi trường.',
    );
  }
  return {
    apiKey,
    baseUrl: process.env.PILL_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.PILL_MODEL || 'gpt-4o-mini',
    cwd,
    maxSteps: Number(process.env.PILL_MAX_STEPS) || 25,
  };
}
