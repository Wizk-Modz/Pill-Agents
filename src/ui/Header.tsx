// Header một dòng: tên phiên, model, effort, thư mục và nhánh git.
import React from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import type { AgentMode } from '../types.js';
import { fitText, shortenCwd } from './format.js';

export function Header({
  version,
  mode,
  model,
  effort,
  cwd,
  branch,
  columns,
}: {
  version: string;
  mode: AgentMode;
  model: string;
  effort?: string;
  cwd: string;
  branch?: string;
  columns: number;
}): React.ReactElement {
  const label = version.replace(/^pill\s+/i, '');
  const narrow = columns < 72;
  const parts = narrow
    ? [model, branch]
    : [model, effort, shortenCwd(cwd, homedir()), branch];
  const details = parts.filter((part): part is string => Boolean(part)).join(' · ');
  const rule = '─'.repeat(Math.max(1, columns));

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold color="cyan">
            PillAgents {fitText(label, Math.max(8, columns - 28))}
          </Text>
          <Text bold color={mode === 'plan' ? 'magenta' : 'green'}>
            {' '}
            {mode.toUpperCase()}
          </Text>
          {details ? <Text dimColor> · {details}</Text> : null}
        </Text>
      </Box>
      <Text dimColor>{rule}</Text>
    </Box>
  );
}
