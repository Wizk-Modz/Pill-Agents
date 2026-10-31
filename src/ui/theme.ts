// Bảng màu, glyph và quy ước hiển thị dùng chung cho TUI.
import type { AgentMode } from '../types.js';

export const COLORS = {
  accent: 'cyan',
  plan: 'magenta',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  muted: 'gray',
  border: 'gray',
} as const;

export const GLYPHS = {
  brand: '◆',
  prompt: '❯',
  cursor: '▌',
  rail: '│',
  bullet: '•',
  thinking: '✻',
  success: '✓',
  error: '✗',
  pending: '●',
  expand: '▸',
  collapse: '▾',
  badgeLeft: '▐',
  badgeRight: '▌',
  queue: '↳',
} as const;

const TOOL_ICONS: Record<string, string> = {
  read_file: '▤',
  write_file: '✎',
  edit_file: '±',
  bash: '$',
  grep: '≡',
  glob: '◇',
};

// Trả icon một ô cho tên tool, dùng bullet nếu tool lạ.
export function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? GLYPHS.bullet;
}

// Chọn màu nhấn theo chế độ đang chạy.
export function modeColor(mode: AgentMode): string {
  return mode === 'plan' ? COLORS.plan : COLORS.accent;
}

// Bộ ký tự viền; dùng ASCII khi terminal không hỗ trợ box drawing.
export function borderChars(): { tl: string; tr: string; bl: string; br: string; h: string; v: string } {
  if (process.env.PILL_ASCII === '1' || process.env.TERM === 'dumb') {
    return { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
  }
  return { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
}
