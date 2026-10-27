// Gợi ý lệnh gạch chéo khi người dùng gõ "/" ở đầu prompt.
export type SlashCommand = {
  name: string;
  description: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/plan', description: 'Chuyển sang chế độ plan (chỉ đọc)' },
  { name: '/build', description: 'Chuyển sang chế độ build (đầy đủ tool)' },
  { name: '/mode', description: 'Xem chế độ hiện tại' },
  { name: '/clear', description: 'Xoá hội thoại và nạp lại PILL.md' },
  { name: '/model', description: 'Xem hoặc đổi model: /model <tên>' },
  { name: '/effort', description: 'Xem hoặc đổi mức effort: /effort <low|medium|high|xhigh|max>' },
  { name: '/help', description: 'Xem phím tắt' },
  { name: '/exit', description: 'Thoát PillAgents' },
];

// Lọc lệnh khớp phần đầu của input; chỉ gợi ý khi input bắt đầu bằng "/" và chưa có tham số.
export function suggestCommands(value: string): SlashCommand[] {
  if (!value.startsWith('/') || /\s/.test(value)) return [];
  const prefix = value.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(prefix));
}

// Điền lệnh được chọn vào prompt, giữ dấu cách để gõ tiếp tham số.
export function applySuggestion(command: SlashCommand): string {
  return command.name === '/exit' ||
    command.name === '/clear' ||
    command.name === '/help' ||
    command.name === '/plan' ||
    command.name === '/build' ||
    command.name === '/mode'
    ? command.name
    : `${command.name} `;
}
