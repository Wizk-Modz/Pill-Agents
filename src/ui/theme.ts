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
  auto: 'yellow',
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
  Read: '▤',
  Write: '✎',
  Edit: '±',
  bash: '$',
  grep: '≡',
  Glob: '◇',
};

// Trả icon một ô cho tên tool, dùng bullet nếu tool lạ.
export function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? GLYPHS.bullet;
}

// Chọn màu nhấn theo chế độ đang chạy.
export function modeColor(mode: AgentMode): string {
  return mode === 'plan' ? COLORS.plan : COLORS.accent;
}

// Badge chế độ kèm nhãn AUTO khi đang bật tự duyệt; hẹp thì bỏ khung để đủ chỗ.
export function modeBadge(mode: AgentMode, auto: boolean, narrow: boolean): string {
  const name = mode.toUpperCase();
  const label = auto ? `${name} AUTO` : name;
  return narrow ? label : `${GLYPHS.badgeLeft} ${label} ${GLYPHS.badgeRight}`;
}

// Bộ ký tự viền; dùng ASCII khi terminal không hỗ trợ box drawing.
export function borderChars(): { tl: string; tr: string; bl: string; br: string; h: string; v: string } {
  if (process.env.PILL_ASCII === '1' || process.env.TERM === 'dumb') {
    return { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
  }
  return { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
}
