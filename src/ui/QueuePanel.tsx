// Bảng tin nhắn đang xếp hàng, hiện tối đa vài tin ngay trên ô nhập.
import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, GLYPHS } from './theme.js';

const MAX_VISIBLE = 3;

// Tính chiều cao của bảng hàng đợi để App cộng vào chrome.
export function queuePanelHeight(queue: string[], maxVisible = 2): number {
  if (!queue.length) return 0;
  const shown = Math.min(MAX_VISIBLE, Math.max(1, maxVisible));
  return 1 + Math.min(queue.length, shown) + (queue.length > shown ? 1 : 0);
}

export function QueuePanel({
  queue,
  maxVisible = 2,
}: {
  queue: string[];
  maxVisible?: number;
}): React.ReactElement | null {
  if (!queue.length) return null;
  const shown = Math.min(MAX_VISIBLE, Math.max(1, maxVisible));
  const visible = queue.slice(0, shown);
  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      <Text>
        <Text color={COLORS.accent}>{GLYPHS.queue} </Text>
        <Text dimColor>{queue.length} tin đang chờ</Text>
      </Text>
      {visible.map((text, index) => (
        <Text key={index} dimColor wrap="truncate-end">
          {'  '}
          <Text color={COLORS.accent}>{index + 1}.</Text> {text.split('\n')[0] ?? ''}
        </Text>
      ))}
      {queue.length > shown ? (
        <Text dimColor> … +{queue.length - shown} tin</Text>
      ) : null}
    </Box>
  );
}
