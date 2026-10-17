#!/usr/bin/env node
// Điểm vào: nạp .env, tạo agent và mở giao diện full-screen.
import React from 'react';
import { render } from 'ink';
import { Agent } from './agent.js';
import { loadConfig } from './config.js';
import { createTools } from './tools.js';
import { App } from './ui/App.js';

const VERSION = 'pill 0.1.0';

// In hướng dẫn khi thiếu API key thay vì mở giao diện.
function fail(message: string): never {
  process.stderr.write(`${message}\n\nVí dụ:\n  PILL_API_KEY=sk-... PILL_BASE_URL=https://api.openai.com/v1 PILL_MODEL=gpt-4o-mini pill\n`);
  process.exit(1);
}

// Khởi động ứng dụng.
function main(): void {
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
  const instance = render(<App agent={agent} config={config} version={VERSION} />, {
    alternateScreen: true,
    exitOnCtrlC: false,
  });
  void instance.waitUntilExit();
}

main();
