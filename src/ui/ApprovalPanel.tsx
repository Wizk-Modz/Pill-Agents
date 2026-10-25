// Hiển thị hộp duyệt tool từ các dòng ANSI đã dựng sẵn.
import React from 'react';
import { Box, Text } from 'ink';

export function ApprovalPanel({ lines }: { lines: string[] }): React.ReactElement | null {
  if (!lines.length) return null;
  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}
