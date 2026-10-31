// Header một dòng: thương hiệu, chế độ, thư mục và nhánh git.
import React from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import type { AgentMode } from '../types.js';
import { fitText, shortenCwd } from './format.js';
import { borderChars, COLORS, GLYPHS, modeColor } from './theme.js';

export function Header({
  version,
  mode,
  cwd,
  branch,
  columns,
}: {
  version: string;
  mode: AgentMode;
  cwd: string;
  branch?: string;
  columns: number;
}): React.ReactElement {
  const label = version.replace(/^pill\s+/i, '');
  const narrow = columns < 44;
  const showVersion = columns >= 100;
  const brand = `${GLYPHS.brand} PillAgents`;
  const badge = narrow ? mode.toUpperCase() : `${GLYPHS.badgeLeft} ${mode.toUpperCase()} ${GLYPHS.badgeRight}`;
  const leftPlain = `${brand}${showVersion ? ` ${label}` : ''} ${badge}`;
  const metaParts = [shortenCwd(cwd, homedir())];
  if (branch && columns >= 64) metaParts.push(branch);
  const meta = metaParts.filter(Boolean).join(' · ');
  const available = Math.max(10, columns - 2);
  const metaWidth = available - leftPlain.length - 1;
  const showMeta = !narrow && metaWidth >= 12;
  const shownMeta = showMeta ? fitText(meta, metaWidth) : '';
  const gap = Math.max(1, available - leftPlain.length - shownMeta.length);
  const rule = borderChars().h.repeat(Math.max(1, columns));

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold color={COLORS.accent}>
            {GLYPHS.brand}{' '}
          </Text>
          <Text bold>PillAgents</Text>
          {showVersion ? <Text dimColor> {label}</Text> : null}
          <Text> </Text>
          <Text bold color={modeColor(mode)}>
            {badge}
          </Text>
          {showMeta ? (
            <Text dimColor>
              {' '.repeat(gap)}
              {shownMeta}
            </Text>
          ) : null}
        </Text>
      </Box>
      <Text dimColor>{rule}</Text>
    </Box>
  );
}
