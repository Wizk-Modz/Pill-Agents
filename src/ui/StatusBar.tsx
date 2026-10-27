// Footer: trạng thái phiên, token, số tool, thời gian và gợi ý phím theo ngữ cảnh.
import React from 'react';
import { Box, Text } from 'ink';
import type { AgentMode } from '../types.js';
import { SPINNER_FRAMES, formatElapsed, formatTokens } from './format.js';

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// Đếm ký tự hiển thị sau khi bỏ mã màu ANSI.
function visibleLength(text: string): number {
  return [...text.replace(ANSI_PATTERN, '')].length;
}

export function StatusBar({
  version,
  mode,
  model,
  effort,
  tokens,
  toolCount,
  elapsedMs,
  busy,
  queueCount,
  statusText,
  spinnerFrame,
  scrolledLines,
  columns,
}: {
  version: string;
  mode: AgentMode;
  model: string;
  effort?: string;
  tokens: { prompt: number; completion: number; last: number };
  toolCount: number;
  elapsedMs: number;
  busy: boolean;
  queueCount: number;
  statusText?: string;
  spinnerFrame: number;
  scrolledLines: number;
  columns: number;
}): React.ReactElement {
  const parts: React.ReactNode[] = [];
  let leftPlain = '';
  if (statusText) {
    leftPlain = statusText;
    parts.push(<Text key="custom">{statusText}</Text>);
  } else {
    // Header đã hiện model/effort; footer hẹp chỉ giữ phiên bản để nhường chỗ cho trạng thái.
    const session = columns >= 100 ? `${version} · ${model}${effort ? ` · ${effort}` : ''}` : version;
    leftPlain += session;
    parts.push(<Text key="session">{session}</Text>);
    if (tokens.last > 0) {
      const prompt = formatTokens(tokens.prompt);
      const completion = formatTokens(tokens.completion);
      leftPlain += ` · ↑${prompt} ↓${completion}`;
      parts.push(
        <Text key="tokens">
          {' · '}
          <Text color="magenta">↑{prompt}</Text>
          <Text dimColor> </Text>
          <Text color="cyan">↓{completion}</Text>
        </Text>,
      );
    }
    if (toolCount > 0) {
      const text = ` · ${toolCount} tool`;
      leftPlain += text;
      parts.push(<Text key="tools">{text}</Text>);
    }
    if (elapsedMs > 0) {
      const text = ` · ${formatElapsed(elapsedMs)}`;
      leftPlain += text;
      parts.push(<Text key="elapsed">{text}</Text>);
    }
  }
  if (busy) {
    const text = ` · ${SPINNER_FRAMES[spinnerFrame] ?? '⠼'} đang xử lý (Esc huỷ)`;
    leftPlain += text;
    parts.push(
      <Text key="busy" color="yellow">
        {text}
      </Text>,
    );
  }
  if (queueCount > 0) {
    const text = ` · ⏳ ${queueCount} chờ`;
    leftPlain += text;
    parts.push(
      <Text key="queue" color="cyan">
        {text}
      </Text>,
    );
  }

  const right =
    scrolledLines > 0
      ? `↑ đã cuộn ${scrolledLines} dòng · PageDown về cuối`
      : busy
        ? 'Esc huỷ'
        : `Tab ${mode === 'plan' ? 'build' : 'plan'} · Enter gửi · /help`;
  const rightLength = visibleLength(right);
  const showRight = columns >= 64 && visibleLength(leftPlain) + rightLength + 4 <= columns;
  const leftWidth = Math.max(10, columns - 2 - (showRight ? rightLength + 1 : 0));

  return (
    <Box paddingX={1} flexShrink={0}>
      <Box width={leftWidth} flexShrink={0}>
        <Text dimColor wrap="truncate-end">
          {parts}
        </Text>
      </Box>
      {showRight ? (
        <Text dimColor wrap="truncate-end">
          {right}
        </Text>
      ) : null}
    </Box>
  );
}
