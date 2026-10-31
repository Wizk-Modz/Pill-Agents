// Hiển thị hộp duyệt tool dạng capsule từ các dòng ANSI đã dựng sẵn.
import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './theme.js';

export function ApprovalPanel({
  lines,
  columns,
}: {
  lines: string[];
  columns: number;
}): React.ReactElement | null {
  if (!lines.length) return null;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.warning} paddingX={1} width={columns}>
        {lines.map((line, index) => (
          <Text key={index} wrap="truncate-end">
            {line || ' '}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
