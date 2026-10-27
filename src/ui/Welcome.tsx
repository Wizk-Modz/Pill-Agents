// Màn hình chào khi phiên chưa có tin nhắn nào.
import React from 'react';
import { Box, Text } from 'ink';

export function Welcome({ version }: { version: string }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        PillAgents <Text dimColor>{version.replace(/^pill\s+/i, '')}</Text>
      </Text>
      <Text dimColor>Coding agent trong terminal — đọc code, sửa lỗi, chạy lệnh và kiểm thử.</Text>
      <Text> </Text>
      <Text>
        <Text color="cyan">/help</Text>
        <Text dimColor> xem phím tắt · </Text>
        <Text color="cyan">/model</Text>
        <Text dimColor> đổi model · </Text>
        <Text color="cyan">/effort</Text>
        <Text dimColor> đổi mức suy luận</Text>
      </Text>
      <Text>
        <Text color="magenta">Tab</Text>
        <Text dimColor> đổi chế độ plan (chỉ đọc) ↔ build. Click tiêu đề Thinking hoặc tool để mở rộng.</Text>
      </Text>
      <Text dimColor>Gõ yêu cầu bên dưới rồi Enter để bắt đầu.</Text>
    </Box>
  );
}
