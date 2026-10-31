// Ô nhập dạng capsule: một dòng ❯, tự giãn tối đa 8 dòng, có viền trên dưới.
import React from 'react';
import { Box, Text } from 'ink';
import type { AgentMode } from '../types.js';
import { fitText } from './format.js';
import { borderChars, COLORS, GLYPHS, modeColor } from './theme.js';

export type InputState = { value: string; cursor: number; historyIndex: number };

// Các cờ phím mà bộ xử lý input cần.
export type KeyLike = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
};

// Key rỗng, dùng khi cần giả lập một phím riêng lẻ.
export const EMPTY_KEY: KeyLike = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
};

export type InputChunk = { text: string; start: number; end: number };

// Chèn chuỗi vào vị trí con trỏ.
function insertAt(value: string, cursor: number, text: string): { value: string; cursor: number } {
  return { value: value.slice(0, cursor) + text + value.slice(cursor), cursor: cursor + text.length };
}

// Đưa con trỏ lên dòng trên, hoặc lùi về mục lịch sử trước đó khi đang ở dòng đầu.
function moveCursorUp(state: InputState, history: string[]): InputState {
  const { value, cursor } = state;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  if (lineStart > 0) {
    const column = cursor - lineStart;
    const previousStart = value.lastIndexOf('\n', lineStart - 2) + 1;
    const previousLength = lineStart - 1 - previousStart;
    return { ...state, cursor: previousStart + Math.min(column, previousLength) };
  }
  if (!history.length) return state;
  const index = Math.min(history.length - 1, state.historyIndex + 1);
  const next = history[history.length - 1 - index] ?? '';
  return { value: next, cursor: next.length, historyIndex: index };
}

// Đưa con trỏ xuống dòng dưới, hoặc tiến tới mục lịch sử sau đó khi đang ở dòng cuối.
function moveCursorDown(state: InputState, history: string[]): InputState {
  const { value, cursor } = state;
  const nextBreak = value.indexOf('\n', cursor);
  if (nextBreak !== -1) {
    const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
    const column = cursor - lineStart;
    const nextStart = nextBreak + 1;
    const nextEnd = value.indexOf('\n', nextStart);
    const nextLength = (nextEnd === -1 ? value.length : nextEnd) - nextStart;
    return { ...state, cursor: nextStart + Math.min(column, nextLength) };
  }
  if (state.historyIndex < 0) return state;
  const index = state.historyIndex - 1;
  const next = index < 0 ? '' : history[history.length - 1 - index] ?? '';
  return { value: next, cursor: next.length, historyIndex: index };
}

// Xử lý phím cho ô nhập, trả về state mới hoặc lệnh gửi.
export function reduceInput(
  state: InputState,
  input: string,
  key: KeyLike,
  history: string[],
): { state: InputState; submit?: string } {
  const { value, cursor } = state;

  // Enter gửi; "\" + Enter hoặc Shift+Enter chèn xuống dòng.
  if (key.return && !key.shift) {
    if (cursor > 0 && value[cursor - 1] === '\\') {
      const next = insertAt(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1, '\n');
      return { state: { ...next, historyIndex: -1 } };
    }
    const text = value.trim();
    return text ? { state: { value: '', cursor: 0, historyIndex: -1 }, submit: text } : { state };
  }
  if (key.return && key.shift) {
    const next = insertAt(value, cursor, '\n');
    return { state: { ...next, historyIndex: -1 } };
  }
  if (key.leftArrow) return { state: { ...state, cursor: Math.max(0, cursor - 1) } };
  if (key.rightArrow) return { state: { ...state, cursor: Math.min(value.length, cursor + 1) } };
  if (key.home) return { state: { ...state, cursor: 0 } };
  if (key.end) return { state: { ...state, cursor: value.length } };
  if (key.backspace) {
    if (cursor === 0) return { state };
    const next = value.slice(0, cursor - 1) + value.slice(cursor);
    return { state: { value: next, cursor: cursor - 1, historyIndex: -1 } };
  }
  if (key.delete) {
    if (cursor >= value.length) return { state };
    const next = value.slice(0, cursor) + value.slice(cursor + 1);
    return { state: { value: next, cursor, historyIndex: -1 } };
  }
  // ↑/↓ (và Ctrl+P/Ctrl+N) di chuyển giữa các dòng khi đang soạn nhiều dòng, ngược lại là lịch sử.
  if (key.upArrow) return { state: moveCursorUp(state, history) };
  if (key.downArrow) return { state: moveCursorDown(state, history) };
  if (input && key.ctrl && !key.meta) {
    if (input === 'j') {
      const next = insertAt(value, cursor, '\n');
      return { state: { ...next, historyIndex: -1 } };
    }
    if (input === 'a') return { state: { ...state, cursor: 0 } };
    if (input === 'e') return { state: { ...state, cursor: value.length } };
    if (input === 'p') return { state: moveCursorUp(state, history) };
    if (input === 'n') return { state: moveCursorDown(state, history) };
    if (input === 'u') {
      // Xoá từ đầu dòng đến con trỏ, giữ nguyên các dòng khác.
      const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
      return { state: { value: value.slice(0, lineStart) + value.slice(cursor), cursor: lineStart, historyIndex: -1 } };
    }
    if (input === 'k') {
      // Xoá từ con trỏ đến cuối dòng, giữ dấu xuống dòng để không dính hai dòng.
      const nextBreak = value.indexOf('\n', cursor);
      const lineEnd = nextBreak === -1 ? value.length : nextBreak;
      return { state: { value: value.slice(0, cursor) + value.slice(lineEnd), cursor, historyIndex: -1 } };
    }
    return { state };
  }
  if (input && !key.meta && !key.tab) {
    const next = insertAt(value, cursor, input);
    return { state: { ...next, historyIndex: -1 } };
  }
  return { state };
}

// Áp dụng chuỗi nhiều ký tự (paste hoặc gõ nhanh) tuần tự như từng phím.
export function reduceString(
  state: InputState,
  text: string,
  history: string[],
): { state: InputState; submit?: string } {
  let current = state;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    const isNewline = char === '\r' || char === '\n';
    if (!isNewline && /[\x00-\x08\x0B-\x1F\x7F]/.test(char)) continue;
    if (char === '\r' && text[index + 1] === '\n') index++;
    const atEnd = index >= text.length - 1;
    const key = isNewline ? { ...EMPTY_KEY, return: true, shift: !atEnd } : EMPTY_KEY;
    const result = reduceInput(current, isNewline ? '' : char, key, history);
    current = result.state;
    if (result.submit) return { state: result.state, submit: result.submit };
  }
  return { state: current };
}

// Chia nội dung ô nhập thành các dòng hiển thị, giữ vị trí con trỏ.
export function layoutInput(value: string, cursor: number, width: number): { chunks: InputChunk[]; cursorChunk: number; cursorCol: number } {
  const limit = Math.max(10, width);
  const chunks: InputChunk[] = [];
  let logicalStart = 0;
  for (const line of value.split('\n')) {
    if (!line.length) {
      chunks.push({ text: '', start: logicalStart, end: logicalStart });
    } else {
      for (let offset = 0; offset < line.length; offset += limit) {
        const text = line.slice(offset, offset + limit);
        chunks.push({ text, start: logicalStart + offset, end: logicalStart + offset + text.length });
      }
    }
    logicalStart += line.length + 1;
  }
  if (!chunks.length) chunks.push({ text: '', start: 0, end: 0 });

  let cursorChunk = chunks.length - 1;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    if (cursor >= chunk.start && cursor <= chunk.end) {
      cursorChunk = index;
      break;
    }
  }
  const chunk = chunks[cursorChunk]!;
  return { chunks, cursorChunk, cursorCol: Math.min(cursor - chunk.start, chunk.text.length) };
}

// Đếm số dòng hiển thị của ô nhập, giới hạn theo maxLines.
export function countInputLines(value: string, cursor: number, columns: number, maxLines: number): number {
  const width = Math.max(10, columns - 6);
  const layout = layoutInput(value, cursor, width);
  return Math.min(maxLines, layout.chunks.length) + 2;
}

// Hiển thị ô nhập trong khung capsule, cuộn nội bộ khi vượt 8 dòng.
export function InputBox({
  value,
  cursor,
  columns,
  busy,
  mode,
  placeholder,
  maxLines = 8,
}: {
  value: string;
  cursor: number;
  columns: number;
  busy: boolean;
  mode: AgentMode;
  placeholder: string;
  maxLines?: number;
}): React.ReactElement {
  const chars = borderChars();
  const accent = busy ? COLORS.warning : modeColor(mode);
  const textWidth = Math.max(10, columns - 6);
  const layout = layoutInput(value, cursor, textWidth);
  const visibleCount = Math.min(maxLines, layout.chunks.length);
  const start = Math.min(
    Math.max(0, layout.cursorChunk - visibleCount + 1),
    Math.max(0, layout.chunks.length - visibleCount),
  );
  const visible = layout.chunks.slice(start, start + visibleCount);
  const title = busy ? 'đang xử lý' : mode === 'plan' ? 'plan' : 'nhập';
  const titleText = ` ${title} `;
  const fill = columns - 3 - titleText.length;
  const ruleWidth = Math.max(1, columns - 2);
  const placeholderText = fitText(placeholder, Math.max(1, textWidth - 1));

  return (
    <Box flexDirection="column" width={columns}>
      {fill >= 1 ? (
        <Text wrap="truncate-end">
          <Text color={COLORS.border} dimColor>
            {chars.tl}
            {chars.h}
          </Text>
          <Text color={accent} bold>
            {titleText}
          </Text>
          <Text color={COLORS.border} dimColor>
            {chars.h.repeat(fill)}
            {chars.tr}
          </Text>
        </Text>
      ) : (
        <Text color={COLORS.border} dimColor wrap="truncate-end">
          {chars.tl}
          {chars.h.repeat(ruleWidth)}
          {chars.tr}
        </Text>
      )}
      {visible.map((chunk, index) => {
        const chunkIndex = start + index;
        const isCursor = chunkIndex === layout.cursorChunk;
        const prefix = chunkIndex === 0 ? `${GLYPHS.prompt} ` : '  ';
        const before = isCursor ? chunk.text.slice(0, layout.cursorCol) : chunk.text;
        const at = isCursor ? chunk.text.slice(layout.cursorCol, layout.cursorCol + 1) || ' ' : '';
        const after = isCursor ? chunk.text.slice(layout.cursorCol + 1) : '';
        const cursorExtra = isCursor && layout.cursorCol >= chunk.text.length ? 1 : 0;
        const pad = Math.max(0, textWidth - chunk.text.length - cursorExtra);
        return (
          <Text key={chunkIndex} wrap="truncate-end">
            <Text color={COLORS.border} dimColor>
              {chars.v}{' '}
            </Text>
            <Text color={accent} bold>
              {prefix}
            </Text>
            {!value && chunkIndex === 0 ? (
              <>
                <Text inverse> </Text>
                <Text dimColor>{placeholderText}</Text>
                <Text>{' '.repeat(Math.max(0, textWidth - 1 - placeholderText.length))}</Text>
              </>
            ) : (
              <>
                <Text>{before}</Text>
                {isCursor ? <Text inverse>{at}</Text> : null}
                <Text>{after}</Text>
                <Text>{' '.repeat(pad)}</Text>
              </>
            )}
            <Text color={COLORS.border} dimColor>
              {' '}
              {chars.v}
            </Text>
          </Text>
        );
      })}
      <Text color={COLORS.border} dimColor wrap="truncate-end">
        {chars.bl}
        {chars.h.repeat(ruleWidth)}
        {chars.br}
      </Text>
    </Box>
  );
}
