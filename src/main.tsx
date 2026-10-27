#!/usr/bin/env node
// Điểm vào: xử lý tham số CLI, nạp cấu hình và mở giao diện full-screen.
import React from 'react';
import { render } from 'ink';
import { Agent } from './agent.js';
import { AGENT_MODES, loadConfig, parseMode } from './config.js';
import { createTools } from './tools.js';
import { App } from './ui/App.js';

const VERSION = '0.1.0';

const HELP = `PillAgents ${VERSION} — coding agent trong terminal

CÁCH DÙNG
  pill [tùy chọn]

TÙY CHỌN
  -h, --help              Hiện trợ giúp này
  -v, --version           In phiên bản
  -m, --model <tên>       Model dùng cho phiên này
  -e, --effort <mức>      Mức suy luận: low, medium, high, xhigh, max
      --mode <chế độ>     Chế độ: build (mặc định) hoặc plan (chỉ đọc)
      --base-url <url>    Endpoint tương thích OpenAI
      --max-steps <n>     Số bước tool tối đa mỗi lượt (mặc định không giới hạn)
      --config-dir <dir>  Thư mục cấu hình (mặc định ~/.pill)

BIẾN MÔI TRƯỜNG
  PILL_API_KEY            API key (bắt buộc)
  PILL_BASE_URL           Endpoint, mặc định https://api.openai.com/v1
  PILL_MODEL              Model, mặc định gpt-4o-mini
  PILL_EFFORT             Mức suy luận
  PILL_MODE               Chế độ mặc định: build hoặc plan
  PILL_MAX_STEPS          Số bước tool tối đa
  PILL_CONFIG_DIR         Thư mục cấu hình

CẤU HÌNH
  ~/.pill/settings.json   {"env": {"PILL_API_KEY": "sk-..."}}
  ~/.pill/PILL.md         Hướng dẫn chung cho mọi dự án
  ./PILL.md               Hướng dẫn riêng dự án

VÍ DỤ
  pill
  pill --model gpt-5 --effort high
  pill --mode plan
  pill --base-url http://localhost:11434/v1 --model qwen2.5-coder

Phím tắt trong phiên: gõ /help
`;

type Args = {
  model?: string;
  effort?: string;
  mode?: string;
  baseUrl?: string;
  maxSteps?: string;
  configDir?: string;
};

// Đọc tham số dòng lệnh, trả về hành động cần làm hoặc các giá trị ghi đè.
function parseArgs(argv: string[]): { action: 'run'; args: Args } | { action: 'help' | 'version'; args: Args } {
  const args: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '-h' || arg === '--help') return { action: 'help', args };
    if (arg === '-v' || arg === '--version') return { action: 'version', args };

    const takeValue = (): string => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        process.stderr.write(`Thiếu giá trị cho ${arg}\n`);
        process.exit(1);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '-m':
      case '--model':
        args.model = takeValue();
        break;
      case '-e':
      case '--effort':
        args.effort = takeValue();
        break;
      case '--mode':
        args.mode = takeValue();
        break;
      case '--base-url':
        args.baseUrl = takeValue();
        break;
      case '--max-steps':
        args.maxSteps = takeValue();
        break;
      case '--config-dir':
        args.configDir = takeValue();
        break;
      default:
        process.stderr.write(`Tùy chọn không hợp lệ: ${arg}\nChạy "pill --help" để xem hướng dẫn.\n`);
        process.exit(1);
    }
  }
  return { action: 'run', args };
}

// In hướng dẫn khi khởi động thất bại.
function fail(message: string): never {
  process.stderr.write(`${message}\n\nChạy "pill --help" để xem hướng dẫn.\n`);
  process.exit(1);
}

// Khởi động ứng dụng.
function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.action === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.action === 'version') {
    process.stdout.write(`pill ${VERSION}\n`);
    return;
  }

  // Tham số dòng lệnh ghi đè cấu hình trước khi nạp.
  const args = parsed.args;
  if (args.configDir) process.env.PILL_CONFIG_DIR = args.configDir;
  if (args.model) process.env.PILL_MODEL = args.model;
  if (args.effort) process.env.PILL_EFFORT = args.effort;
  if (args.mode) {
    if (!parseMode(args.mode)) {
      fail(`Chế độ không hợp lệ: ${args.mode}. Chọn: ${AGENT_MODES.join(' hoặc ')}.`);
    }
    process.env.PILL_MODE = args.mode;
  }
  if (args.baseUrl) process.env.PILL_BASE_URL = args.baseUrl;
  if (args.maxSteps) process.env.PILL_MAX_STEPS = args.maxSteps;

  if (!process.stdin.isTTY) {
    fail('Cần chạy trong terminal tương tác (TTY).');
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const agent = new Agent(config, createTools(config.cwd));
  const instance = render(<App agent={agent} config={config} version={`pill ${VERSION}`} />, {
    alternateScreen: true,
    exitOnCtrlC: false,
  });
  void instance.waitUntilExit();
}

main();
