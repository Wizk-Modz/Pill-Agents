// Bảng tin nhắn đang xếp hàng, hiện tối đa ba tin ngay trên ô nhập.
import React from 'react';
import { Box, Text } from 'ink';

const MAX_VISIBLE = 3;

// Tính chiều cao của bảng hàng đợi để App cộng vào chrome.
export function queuePanelHeight(queue: string[]): number {
  if (!queue.length) return 0;
  return 1 + Math.min(queue.length, MAX_VISIBLE) + (queue.length > MAX_VISIBLE ? 1 : 0);
}

export function QueuePanel({ queue }: { queue: string[] }): React.ReactElement | null {
  if (!queue.length) return null;
  const shown = queue.slice(0, MAX_VISIBLE);
  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      <Text color="cyan" dimColor>
        Hàng đợi ({queue.length})
      </Text>
      {shown.map((text, index) => (
        <Text key={index} dimColor wrap="truncate-end">
          {' '}
          {index + 1}. {text.split('\n')[0] ?? ''}
        </Text>
      ))}
      {queue.length > MAX_VISIBLE ? (
        <Text dimColor> … +{queue.length - MAX_VISIBLE} tin</Text>
      ) : null}
    </Box>
  );
}
