// Màn hình chào khi phiên chưa có tin nhắn: logo capsule, gợi ý lệnh và phím.
import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, GLYPHS } from './theme.js';

export function Welcome({
  version,
  columns = 80,
  rows = 24,
}: {
  version: string;
  columns?: number;
  rows?: number;
}): React.ReactElement {
  const label = version.replace(/^pill\s+/i, '');
  const compact = rows < 22 || columns < 64;
  const keyWidth = compact ? 8 : 16;

  // Tạo một dòng gợi ý với phím tắt tô màu và mô tả mờ.
  const hint = (key: string, description: string): React.ReactElement => (
    <Text>
      <Text color={COLORS.accent}>{key.padEnd(keyWidth)}</Text>
      <Text dimColor>{description}</Text>
    </Text>
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={compact ? 0 : 1} flexShrink={0}>
      {compact ? (
        <Text>
          <Text bold color={COLORS.accent}>
            {GLYPHS.brand} PillAgents
          </Text>
          <Text dimColor> {label}</Text>
        </Text>
      ) : (
        <>
          <Box alignSelf="flex-start" borderStyle="round" borderColor={COLORS.accent} paddingX={1}>
            <Text>
              <Text color={COLORS.accent}>◖</Text>
              <Text bold> PillAgents </Text>
              <Text color={COLORS.accent}>◗</Text>
            </Text>
          </Box>
          <Text dimColor>
            {' '}
            {label} · Coding agent trong terminal
          </Text>
        </>
      )}
      <Text dimColor>Đọc code, sửa lỗi, chạy lệnh và kiểm thử ngay trong terminal.</Text>
      <Text> </Text>
      {hint('/help', 'xem lệnh và phím tắt')}
      {hint('Tab', compact ? 'plan ↔ build' : 'đổi chế độ plan ↔ build')}
      {compact ? null : hint('/model, /effort', 'đổi model · mức suy luận')}
      {compact ? null : hint('Ctrl+O / Ctrl+T', 'mở rộng thinking / tool')}
      <Text> </Text>
      <Text dimColor>Gõ yêu cầu bên dưới rồi Enter để bắt đầu.</Text>
    </Box>
  );
}
