// Bộ đọc phím thô: gộp escape sequence bị tách, nhận diện chuột và bracketed paste.
import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';

import type { KeyLike } from './InputBox.js';

export type ParsedKey = KeyLike & {
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
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

export type KeyEvent =
  | { type: 'key'; key: ParsedKey; char: string }
  | { type: 'text'; text: string }
  | { type: 'paste'; text: string }
  | { type: 'wheel'; direction: 'up' | 'down' }
  | { type: 'click'; row: number; column: number };

// Tạo đối tượng key với mọi cờ mặc định là false.
export function makeKey(partial: Partial<ParsedKey> = {}): ParsedKey {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageUp: false,
    pageDown: false,
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
    ...partial,
  };
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const MOUSE_PREFIX = '\x1b[<';

// Bảng escape sequence, xếp dài trước để khớp chính xác.
const SEQUENCE_LIST: Array<readonly [string, Partial<ParsedKey>]> = [
  ['\x1b[1;2A', { upArrow: true, shift: true }],
  ['\x1b[1;2B', { downArrow: true, shift: true }],
  ['\x1b[1;3A', { upArrow: true, meta: true }],
  ['\x1b[1;3B', { downArrow: true, meta: true }],
  ['\x1b[1;5A', { upArrow: true, ctrl: true }],
  ['\x1b[1;5B', { downArrow: true, ctrl: true }],
  ['\x1b[1;5C', { rightArrow: true, ctrl: true }],
  ['\x1b[1;5D', { leftArrow: true, ctrl: true }],
  ['\x1b[3~', { delete: true }],
  ['\x1b[5~', { pageUp: true }],
  ['\x1b[6~', { pageDown: true }],
  ['\x1b[1~', { home: true }],
  ['\x1b[4~', { end: true }],
  ['\x1b[7~', { home: true }],
  ['\x1b[8~', { end: true }],
  ['\x1b[2~', {}],
  ['\x1b[H', { home: true }],
  ['\x1b[F', { end: true }],
  ['\x1bOH', { home: true }],
  ['\x1bOF', { end: true }],
  ['\x1b[A', { upArrow: true }],
  ['\x1b[B', { downArrow: true }],
  ['\x1b[C', { rightArrow: true }],
  ['\x1b[D', { leftArrow: true }],
  ['\x1bOA', { upArrow: true }],
  ['\x1bOB', { downArrow: true }],
  ['\x1bOC', { rightArrow: true }],
  ['\x1bOD', { leftArrow: true }],
  ['\x1b[Z', { tab: true, shift: true }],
  ['\x1b\r', { return: true, meta: true }],
  ['\x1b\n', { return: true, meta: true }],
];

const SEQUENCES = [...SEQUENCE_LIST].sort((a, b) => b[0].length - a[0].length);

// Kiểm tra chuỗi có phải phần đầu của một sequence chưa hoàn chỉnh.
function isIncomplete(rest: string): boolean {
  if (PASTE_START.startsWith(rest) || MOUSE_PREFIX.startsWith(rest)) return true;
  if (rest.startsWith(MOUSE_PREFIX)) return /^\x1b\[<[\d;]*$/.test(rest);
  return SEQUENCES.some(([sequence]) => sequence.startsWith(rest));
}

// Phân tích buffer đầu vào; trả các sự kiện và phần còn chờ.
export function parseInput(buffer: string, flush: boolean): { events: KeyEvent[]; rest: string } {
  const events: KeyEvent[] = [];
  let index = 0;

  while (index < buffer.length) {
    const char = buffer[index]!;

    if (char === '\x1b') {
      const rest = buffer.slice(index);

      if (rest.startsWith(PASTE_START)) {
        const end = rest.indexOf(PASTE_END, PASTE_START.length);
        if (end === -1) {
          if (!flush) return { events, rest };
          const text = rest.slice(PASTE_START.length);
          if (text) events.push({ type: 'paste', text });
          index = buffer.length;
          continue;
        }
        const text = rest.slice(PASTE_START.length, end);
        if (text) events.push({ type: 'paste', text });
        index += end + PASTE_END.length;
        continue;
      }
      if (rest.startsWith(PASTE_END)) {
        index += PASTE_END.length;
        continue;
      }

      const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest);
      if (mouse) {
        const code = Number(mouse[1]);
        const column = Number(mouse[2]);
        const row = Number(mouse[3]);
        const button = code & 3;
        const press = mouse[4] === 'M';
        if ((code & 64) !== 0) {
          // Bánh xe lăn; bỏ qua bánh ngang và sự kiện di chuyển.
          if (button === 0) events.push({ type: 'wheel', direction: 'up' });
          else if (button === 1) events.push({ type: 'wheel', direction: 'down' });
        } else if (press && button === 0 && (code & 32) === 0 && (code & 4) === 0) {
          // Chuột trái nhấn; bỏ qua kéo thả và Shift+click để giữ chọn văn bản.
          events.push({ type: 'click', row, column });
        }
        index += mouse[0].length;
        continue;
      }

      const sequence = SEQUENCES.find(([value]) => rest.startsWith(value));
      if (sequence) {
        const [value, partial] = sequence;
        events.push({ type: 'key', key: makeKey(partial), char: '' });
        index += value.length;
        continue;
      }

      if (!flush && (rest.length === 1 || isIncomplete(rest))) {
        return { events, rest };
      }

      // ESC đơn lẻ hoặc sequence lạ: coi là phím Escape.
      events.push({ type: 'key', key: makeKey({ escape: true }), char: '' });
      index += 1;
      continue;
    }

    // Enter gửi \r; Ctrl+J gửi \n và được dùng để xuống dòng.
    if (char === '\r') {
      events.push({ type: 'key', key: makeKey({ return: true }), char: '' });
      index += 1;
      continue;
    }
    if (char === '\n') {
      events.push({ type: 'key', key: makeKey({ ctrl: true }), char: 'j' });
      index += 1;
      continue;
    }
    if (char === '\t') {
      events.push({ type: 'key', key: makeKey({ tab: true }), char: '' });
      index += 1;
      continue;
    }
    if (char === '\x7f' || char === '\x08') {
      events.push({ type: 'key', key: makeKey({ backspace: true }), char: '' });
      index += 1;
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 32) {
      if (code > 0) {
        events.push({ type: 'key', key: makeKey({ ctrl: true }), char: String.fromCharCode(code + 96) });
      }
      index += 1;
      continue;
    }

    // Gom cả cụm ký tự in được (gõ nhanh hoặc paste không có marker).
    let end = index;
    while (end < buffer.length) {
      const current = buffer.charCodeAt(end);
      if (current === 27 || current < 32 || current === 127) break;
      end += 1;
    }
    events.push({ type: 'text', text: buffer.slice(index, end) });
    index = end;
  }

  return { events, rest: '' };
}

// Hook đọc stdin thô và phát sự kiện đã chuẩn hoá.
export function useKeys(handler: (event: KeyEvent) => void): void {
  const { stdin, setRawMode } = useStdin();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    setRawMode(true);
    stdin.resume();
    // Bật SGR mouse (1000+1006) và alternate scroll (1007) như Claude Code.
    process.stdout.write('\x1b[?1000h\x1b[?1006h\x1b[?1007h');
    let buffer = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Phát sự kiện từ buffer hiện tại.
    const processBuffer = (flush: boolean): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const result = parseInput(buffer, flush);
      buffer = result.rest;
      for (const event of result.events) handlerRef.current(event);
      if (buffer && !flush) {
        timer = setTimeout(() => processBuffer(true), 60);
      }
    };

    const onData = (data: Buffer | string): void => {
      buffer += typeof data === 'string' ? data : data.toString('utf8');
      processBuffer(false);
    };

    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      if (timer) clearTimeout(timer);
      process.stdout.write('\x1b[?1007l\x1b[?1006l\x1b[?1000l');
      setRawMode(false);
    };
  }, [stdin, setRawMode]);
}
