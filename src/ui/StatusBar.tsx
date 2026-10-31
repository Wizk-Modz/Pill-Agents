// Footer: thông tin phiên, token, số tool, thời gian và gợi ý phím theo ngữ cảnh.
import React from 'react';
import { Box, Text } from 'ink';
import type { AgentMode } from '../types.js';
import { SPINNER_FRAMES, formatElapsed, formatTokens, visibleWidth } from './format.js';
import { COLORS } from './theme.js';

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
  autoTrusted,
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
  autoTrusted?: boolean;
  statusText?: string;
  spinnerFrame: number;
  scrolledLines: number;
  columns: number;
}): React.ReactElement {
  type Metric = { text: string; node: React.ReactNode; optional: boolean };
  const metrics: Metric[] = [];

  if (statusText) {
    metrics.push({ text: statusText, node: <Text key="custom">{statusText}</Text>, optional: false });
  } else {
    const session = columns >= 110 ? `${version} · ${model}` : model;
    metrics.push({ text: session, node: <Text key="session">{session}</Text>, optional: false });
    if (effort && columns >= 80) {
      metrics.push({
        text: ` · ${effort}`,
        node: (
          <Text key="effort" dimColor>
            {' '}
            · {effort}
          </Text>
        ),
        optional: false,
      });
    }
    if (tokens.last > 0) {
      const prompt = formatTokens(tokens.prompt);
      const completion = formatTokens(tokens.completion);
      metrics.push({
        text: ` · ↑${prompt} ↓${completion}`,
        node: (
          <Text key="tokens">
            {' '}
            · <Text color={COLORS.accent}>↑{prompt}</Text>
            <Text dimColor> ↓{completion}</Text>
          </Text>
        ),
        optional: true,
      });
    }
    if (toolCount > 0) {
      const text = ` · ${toolCount} tool`;
      metrics.push({ text, node: <Text key="tools">{text}</Text>, optional: true });
    }
    if (elapsedMs > 0) {
      const text = ` · ${formatElapsed(elapsedMs)}`;
      metrics.push({ text, node: <Text key="elapsed">{text}</Text>, optional: true });
    }
  }

  const suffix: React.ReactNode[] = [];
  let suffixText = '';
  if (busy) {
    const text = columns < 70
      ? ` · ${SPINNER_FRAMES[spinnerFrame] ?? '⠼'} đang xử lý`
      : ` · ${SPINNER_FRAMES[spinnerFrame] ?? '⠼'} đang xử lý (Esc huỷ)`;
    suffixText += text;
    suffix.push(
      <Text key="busy" color={COLORS.warning}>
        {text}
      </Text>,
    );
  }
  if (queueCount > 0) {
    const text = ` · ${queueCount} tin chờ`;
    suffixText += text;
    suffix.push(
      <Text key="queue" color={COLORS.accent}>
        {text}
      </Text>,
    );
  }
  if (autoTrusted) {
    const text = columns < 72 ? ' · auto ✓' : ' · tự duyệt mọi tool';
    suffixText += text;
    suffix.push(
      <Text key="auto" color={COLORS.auto}>
        {text}
      </Text>,
    );
  }

  const right =
    scrolledLines > 0
      ? `↑ ${scrolledLines} dòng · PageDown`
      : busy
        ? ''
        : columns >= 100
          ? `Tab ${mode === 'plan' ? 'build' : 'plan'} · Enter gửi · /help`
          : `Tab ${mode === 'plan' ? 'build' : 'plan'} · /help`;
  const leftText = metrics.map((metric) => metric.text).join('') + suffixText;
  const showRight =
    right !== '' && columns >= 64 && visibleWidth(leftText) + visibleWidth(right) + 4 <= columns;
  const leftWidth = Math.max(10, columns - 2 - (showRight ? visibleWidth(right) + 1 : 0));

  // Bỏ bớt số liệu phụ từ cuối để spinner và số tin chờ luôn còn chỗ hiển thị.
  const kept = [...metrics];
  while (kept.length && visibleWidth(kept.map((metric) => metric.text).join('') + suffixText) > leftWidth) {
    const index = kept.map((metric) => metric.optional).lastIndexOf(true);
    if (index < 0) break;
    kept.splice(index, 1);
  }
  const parts = [...kept.map((metric) => metric.node), ...suffix];

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
