// Giao diện kiểu Claude Code: transcript markdown, prompt ❯, xếp hàng tin nhắn và thinking.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useStdout } from 'ink';
import { Agent } from '../agent.js';
import { EFFORT_LEVELS, parseEffort, type Config } from '../config.js';
import type { ToolCall, ToolResult, Usage } from '../types.js';
import { InputBox, countInputLines, reduceInput, reduceString, type InputState } from './InputBox.js';
import { applySuggestion, suggestCommands } from './commands.js';
import { itemToLines, summarizeToolCall, type ItemBody, type TranscriptItem } from './Transcript.js';
import { makeKey, useKeys, type KeyEvent } from './useKeys.js';

type PendingApproval = { call: ToolCall; resolve: (approved: boolean) => void };

const MAX_PROMPT_LINES = 8;
const STREAM_FLUSH_MS = 60;
const APPROVAL_HEIGHT = 2;
const WHEEL_LINES = 3;

// Theo dõi kích thước terminal và cập nhật khi resize.
function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const stream = stdout as NodeJS.WriteStream;
  const [size, setSize] = useState({ columns: stream.columns || 80, rows: stream.rows || 24 });
  useEffect(() => {
    const update = (): void => setSize({ columns: stream.columns || 80, rows: stream.rows || 24 });
    update();
    stream.on('resize', update);
    return () => {
      stream.off('resize', update);
    };
  }, [stream]);
  return size;
}

// Mô tả ngắn gọn tool đang chờ xác nhận, gộp về một dòng để không vỡ layout.
function approvalDetail(call: ToolCall): string {
  let detail = call.arguments;
  try {
    const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    if (call.name === 'bash') detail = String(args.command ?? '');
    else if (call.name === 'write_file') {
      const size = typeof args.content === 'string' ? args.content.length : 0;
      detail = `${String(args.path ?? '')} (${size} ký tự)`;
    } else if (call.name === 'edit_file') detail = String(args.path ?? '');
  } catch {
    // Hiển thị thô nếu JSON hỏng.
  }
  return detail.replace(/\s+/g, ' ').trim();
}

// Rút gọn số token: 1234 thành 1.2k.
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1)}k`;
}

// Màn hình chính của PillAgents.
export function App({ agent, config, version }: { agent: Agent; config: Config; version: string }): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [streaming, setStreaming] = useState('');
  const [thinkingLive, setThinkingLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [scrollTop, setScrollTop] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [tokenUsage, setTokenUsage] = useState({ prompt: 0, completion: 0, last: 0 });
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [input, setInput] = useState<InputState>({ value: '', cursor: 0, historyIndex: -1 });

  const idRef = useRef(0);
  const textRef = useRef('');
  const thinkingRef = useRef('');
  const thinkingStartRef = useRef<number | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Bản sao state cho handler bất đồng bộ: cập nhật ngay tại chỗ ghi state, không qua
  // useEffect, để tránh ghi đè bằng giá trị cũ khi có nhiều cập nhật trong cùng một frame.
  const pendingRef = useRef<PendingApproval | null>(null);
  const busyRef = useRef(false);
  const inputRef = useRef(input);
  const scrollRef = useRef<number | null>(null);
  const queueRef = useRef<string[]>([]);
  const runTurnRef = useRef<((text: string) => Promise<void>) | null>(null);
  const submitRef = useRef<((text: string) => void) | null>(null);
  const lineCacheRef = useRef(new Map<string, string[]>());
  const cacheWidthRef = useRef(columns);

  // Đưa con trỏ về gợi ý đầu tiên mỗi khi nội dung prompt thay đổi.
  useEffect(() => {
    setSuggestionIndex(0);
  }, [input.value]);

  // Ghi state kèm ref tương ứng, giữ ref luôn đồng bộ với state.
  const setBusySync = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);
  const setPendingSync = useCallback((value: PendingApproval | null) => {
    pendingRef.current = value;
    setPendingApproval(value);
  }, []);
  const setScrollSync = useCallback((value: number | null) => {
    scrollRef.current = value;
    setScrollTop(value);
  }, []);

  // Thêm một mục bất biến vào transcript.
  const pushItem = useCallback((item: ItemBody) => {
    idRef.current += 1;
    const entry = { ...item, id: idRef.current } as TranscriptItem;
    setItems((current) => [...current, entry]);
  }, []);

  // Cập nhật input đồng thời cả state và ref để không rơi ký tự khi gõ nhanh.
  const applyInput = useCallback((next: InputState) => {
    inputRef.current = next;
    setInput(next);
  }, []);

  // Đẩy text/thinking đang stream vào state, gộp cập nhật để giảm số lần render.
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      setStreaming(textRef.current);
      setThinkingLive(thinkingRef.current);
    }, STREAM_FLUSH_MS);
  }, []);

  // Huỷ timer và cập nhật ngay lập tức.
  const flushNow = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    setStreaming(textRef.current);
    setThinkingLive(thinkingRef.current);
  }, []);

  // Chuyển thinking đang stream thành mục cố định, thu gọn lại sau khi xong.
  const commitThinking = useCallback(() => {
    const text = thinkingRef.current.trim();
    thinkingRef.current = '';
    setThinkingLive('');
    const startedAt = thinkingStartRef.current;
    thinkingStartRef.current = null;
    if (!text) return;
    const seconds = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 1000)) : undefined;
    pushItem({ kind: 'thinking', text, expanded: false, seconds });
  }, [pushItem]);

  // Chuyển text đang stream thành mục cố định.
  const commitStreaming = useCallback(() => {
    const text = textRef.current.trim();
    textRef.current = '';
    setStreaming('');
    if (text) pushItem({ kind: 'assistant', text });
  }, [pushItem]);

  // Dừng lượt đang chạy, xoá hàng đợi và từ chối tool đang chờ.
  const abort = useCallback(() => {
    controllerRef.current?.abort();
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
      setPendingSync(null);
    }
    queueRef.current = [];
    setQueue([]);
    commitThinking();
    commitStreaming();
  }, [commitThinking, commitStreaming]);

  // Chạy một lượt với agent và xử lý hàng đợi sau khi xong.
  const runTurn = useCallback(
    async (text: string) => {
      setHistory((current) => [...current, text]);
      pushItem({ kind: 'user', text });

      const controller = new AbortController();
      controllerRef.current = controller;
      textRef.current = '';
      thinkingRef.current = '';
      setStreaming('');
      setThinkingLive('');
      setBusySync(true);
      setScrollSync(null);

      const handlers = {
        onAssistantStart: () => {
          commitThinking();
          textRef.current = '';
          setStreaming('');
        },
        onText: (chunk: string) => {
          if (!textRef.current) commitThinking();
          textRef.current += chunk;
          scheduleFlush();
        },
        onThinking: (chunk: string) => {
          if (!thinkingRef.current) thinkingStartRef.current = Date.now();
          thinkingRef.current += chunk;
          scheduleFlush();
        },
        onToolCall: (call: ToolCall) => {
          commitThinking();
          commitStreaming();
          idRef.current += 1;
          const entry: TranscriptItem = {
            id: idRef.current,
            kind: 'tool',
            call,
            summary: summarizeToolCall(call),
          };
          setItems((current) => [...current, entry]);
        },
        onToolResult: (call: ToolCall, result: ToolResult) => {
          setItems((current) =>
            current.map((item) => {
              if (item.kind === 'tool' && item.call.id === call.id && !item.result) {
                // Xoá cache để dòng tool được render lại với kết quả mới.
                lineCacheRef.current.delete(String(item.id));
                return { ...item, result };
              }
              return item;
            }),
          );
        },
        onUsage: (usage: Usage) => {
          setTokenUsage((current) => ({
            prompt: current.prompt + usage.promptTokens,
            completion: current.completion + usage.completionTokens,
            last: usage.totalTokens,
          }));
        },
        onTurnEnd: () => {
          commitThinking();
          commitStreaming();
        },
        approve: (call: ToolCall) =>
          new Promise<boolean>((resolve) => {
            setPendingSync({ call, resolve });
          }),
      };

      try {
        await agent.send(text, controller.signal, handlers);
      } catch (error) {
        pushItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      } finally {
        flushNow();
        commitThinking();
        commitStreaming();
        setPendingSync(null);
        controllerRef.current = null;
        setBusySync(false);

        const next = queueRef.current.shift();
        if (next) {
          setQueue([...queueRef.current]);
          // Đi qua submit để lệnh gạch chéo xếp hàng được thực thi như lệnh, không gửi cho model.
          setTimeout(() => submitRef.current?.(next), 0);
        }
      }
    },
    [agent, commitStreaming, commitThinking, flushNow, pushItem, scheduleFlush],
  );
  runTurnRef.current = runTurn;

  // Xử lý lệnh gạch chéo; trả true nếu đã xử lý.
  const runCommand = useCallback(
    (text: string): boolean => {
      if (!text.startsWith('/')) return false;
      const [command, ...rest] = text.split(/\s+/);
      if (command === '/exit' || command === '/quit') {
        exit();
        return true;
      }
      if (command === '/clear') {
        agent.reset();
        setItems([]);
        setTokenUsage({ prompt: 0, completion: 0, last: 0 });
        setScrollSync(null);
        pushItem({ kind: 'info', text: 'Đã xoá hội thoại.' });
        return true;
      }
      if (command === '/model') {
        const name = rest.join(' ').trim();
        if (!name) {
          pushItem({ kind: 'info', text: `Model hiện tại: ${config.model}` });
        } else {
          config.model = name;
          pushItem({ kind: 'info', text: `Đã đổi model: ${name}` });
        }
        return true;
      }
      if (command === '/effort') {
        const value = rest.join(' ').trim();
        if (!value) {
          pushItem({
            kind: 'info',
            text: `Effort hiện tại: ${config.effort ?? '(mặc định của model)'} • các mức: ${EFFORT_LEVELS.join(', ')}`,
          });
          return true;
        }
        const parsed = parseEffort(value);
        if (!parsed) {
          pushItem({ kind: 'error', text: `Mức effort không hợp lệ: ${value}. Chọn: ${EFFORT_LEVELS.join(', ')}` });
          return true;
        }
        config.effort = parsed;
        pushItem({ kind: 'info', text: `Đã đổi effort: ${parsed}` });
        return true;
      }
      if (command === '/help') {
        pushItem({
          kind: 'info',
          text: 'Enter gửi • \\ + Enter hoặc Ctrl+J xuống dòng • ↑/↓ lịch sử lệnh • PageUp/PageDown cuộn • lăn chuột cuộn • Esc huỷ lượt • Ctrl+C xoá input/thoát • Ctrl+O mở/đóng thinking • Ctrl+D thoát • /clear /model /effort /help /exit',
        });
        return true;
      }
      pushItem({ kind: 'error', text: `Lệnh không hỗ trợ: ${command}` });
      return true;
    },
    [agent, config, exit, pushItem],
  );

  // Gửi tin nhắn: chạy ngay nếu rảnh, xếp hàng nếu đang bận.
  const submit = useCallback(
    (text: string) => {
      if (busyRef.current) {
        queueRef.current.push(text);
        setQueue([...queueRef.current]);
        pushItem({
          kind: 'info',
          text: `⏳ Đã xếp hàng (${queueRef.current.length}): ${text.split('\n')[0]?.slice(0, 80) ?? ''}`,
        });
        return;
      }
      if (runCommand(text)) return;
      void runTurn(text);
    },
    [pushItem, runCommand, runTurn],
  );
  submitRef.current = submit;

  // Toàn bộ transcript thành các dòng ANSI, cache từng mục để tránh render lại.
  const lines = useMemo<string[]>(() => {
    const cache = lineCacheRef.current;
    // Bề rộng đổi thì dòng đã cache sai wrap: phải xoá ngay trong lúc tính, vì effect
    // chạy sau khi memo đã đọc cache cũ và không kích hoạt render lại.
    if (cacheWidthRef.current !== columns) {
      cache.clear();
      cacheWidthRef.current = columns;
    }
    const output: string[] = [];
    for (const item of items) {
      const key = String(item.id);
      let cached = cache.get(key);
      if (!cached) {
        cached = itemToLines(item, columns);
        cache.set(key, cached);
      }
      output.push(...cached);
    }
    if (thinkingLive) output.push(...itemToLines({ id: -2, kind: 'thinking', text: thinkingLive }, columns));
    if (streaming) {
      const body = itemToLines({ id: -1, kind: 'assistant', text: streaming }, columns);
      output.push(...body.slice(0, -1));
      output.push('  ▌');
    }
    return output;
  }, [items, streaming, thinkingLive, columns]);

  const suggestions = useMemo(() => suggestCommands(input.value), [input.value]);
  const activeSuggestion = suggestions.length ? suggestions[Math.min(suggestionIndex, suggestions.length - 1)] : null;

  const inputLines = countInputLines(input.value, input.cursor, columns, MAX_PROMPT_LINES);
  const suggestionHeight = suggestions.length ? suggestions.length + 1 : 0;
  // Chiều cao chrome: ô nhập (đã gồm 2 đường kẻ), footer 1 dòng, bảng gợi ý và hộp duyệt tool.
  const chromeHeight = inputLines + 1 + suggestionHeight + (pendingApproval ? APPROVAL_HEIGHT : 0);
  const viewportHeight = Math.max(3, rows - chromeHeight);
  const maxTop = Math.max(0, lines.length - viewportHeight);
  const top = scrollTop === null ? maxTop : Math.min(Math.max(0, scrollTop), maxTop);
  const visible = lines.slice(top, top + viewportHeight);
  const scrolled = maxTop > 0 && top < maxTop;

  // Cuộn transcript theo số dòng, chỉ khi nội dung tràn màn hình.
  const scrollBy = useCallback(
    (delta: number) => {
      if (maxTop <= 0) return;
      const current = scrollRef.current === null ? maxTop : Math.min(scrollRef.current, maxTop);
      const next = Math.max(0, Math.min(maxTop, current + delta));
      setScrollSync(next >= maxTop ? null : next);
    },
    [maxTop],
  );

  // Mở/đóng toàn bộ khối thinking, xoá cache để render lại.
  const toggleThinking = useCallback(() => {
    setItems((current) => {
      const thinking = current.filter((item) => item.kind === 'thinking');
      if (!thinking.length) return current;
      const expand = thinking.some((item) => item.kind === 'thinking' && item.expanded === false);
      for (const item of thinking) lineCacheRef.current.delete(String(item.id));
      return current.map((item) =>
        item.kind === 'thinking' ? { ...item, expanded: expand } : item,
      );
    });
  }, []);

  // Xử lý sự kiện phím đã chuẩn hoá.
  const handleKey = useCallback(
    (event: KeyEvent) => {
      if (event.type === 'wheel') {
        scrollBy(event.direction === 'up' ? -WHEEL_LINES : WHEEL_LINES);
        return;
      }

      // Khi chờ duyệt: y/n/Esc trả lời, mọi phím khác bị chặn để tránh gõ nhầm.
      if (pendingRef.current) {
        const text = event.type === 'key' ? event.char : event.type === 'text' ? event.text : '';
        const answer = text.toLowerCase();
        const escape = event.type === 'key' && event.key.escape;
        if (answer === 'y' || answer === 'n' || escape) {
          const entry = pendingRef.current;
              setPendingSync(null);
          entry.resolve(answer === 'y');
        }
        return;
      }

      if (event.type === 'paste' || event.type === 'text') {
        const result = reduceString(inputRef.current, event.text, history);
        applyInput(result.state);
        if (result.submit) submit(result.submit);
        return;
      }

      const { key, char } = event;

      if (key.ctrl && char === 'o') {
        toggleThinking();
        return;
      }

      if (key.ctrl && char === 'c') {
        if (busyRef.current) {
          abort();
        } else if (inputRef.current.value) {
          applyInput({ value: '', cursor: 0, historyIndex: -1 });
        } else {
          exit();
        }
        return;
      }
      if (key.ctrl && char === 'd') {
        exit();
        return;
      }
      if (key.escape) {
        if (busyRef.current) {
          abort();
        } else if (suggestions.length) {
          applyInput({ value: '', cursor: 0, historyIndex: -1 });
        }
        return;
      }

      // Bảng gợi ý lệnh đang mở: Tab điền, ↑/↓ di chuyển, Esc đóng.
      if (suggestions.length) {
        if (key.tab) {
          const chosen = suggestions[Math.min(suggestionIndex, suggestions.length - 1)]!;
          const value = applySuggestion(chosen);
          applyInput({ value, cursor: value.length, historyIndex: -1 });
          setSuggestionIndex(0);
          return;
        }
        if (key.upArrow) {
          setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (key.downArrow) {
          setSuggestionIndex((current) => (current + 1) % suggestions.length);
          return;
        }
      }

      // PageUp/PageDown cuộn theo trang; Shift+↑/↓ cuộn 3 dòng.
      if (key.pageUp || key.pageDown || (key.shift && (key.upArrow || key.downArrow))) {
        if (key.pageUp) scrollBy(-viewportHeight);
        else if (key.pageDown) scrollBy(viewportHeight);
        else if (key.upArrow) scrollBy(-WHEEL_LINES);
        else scrollBy(WHEEL_LINES);
        return;
      }

      const result = reduceInput(inputRef.current, char, key, history);
      if (result.submit) {
        applyInput(result.state);
        submit(result.submit);
      } else if (result.state !== inputRef.current) {
        applyInput(result.state);
      }
    },
    [abort, applyInput, exit, history, scrollBy, submit, suggestions, suggestionIndex, toggleThinking, viewportHeight],
  );

  useKeys(handleKey);

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((line, index) => (
          <Text key={index} wrap="truncate-end">
            {line || ' '}
          </Text>
        ))}
      </Box>

      {pendingApproval ? (
        <Box flexDirection="column" paddingX={1}>
          <Text wrap="truncate-end">
            <Text color="yellow" bold>
              ⏵ Cho phép chạy{' '}
            </Text>
            <Text bold>{pendingApproval.call.name}</Text>
            <Text dimColor> — {approvalDetail(pendingApproval.call).slice(0, columns - 30)}</Text>
          </Text>
          <Text dimColor>
            <Text color="green">[y]</Text> đồng ý · <Text color="red">[n/Esc]</Text> từ chối
          </Text>
        </Box>
      ) : null}

      {suggestions.length ? (
        <Box flexDirection="column" paddingX={1}>
          {suggestions.map((command, index) => {
            const active = command === activeSuggestion;
            return (
              <Text key={command.name} wrap="truncate-end">
                <Text color={active ? 'cyan' : undefined} bold={active} inverse={active}>
                  {' '}
                  {command.name}
                </Text>
                <Text dimColor> {command.description}</Text>
              </Text>
            );
          })}
          <Text dimColor>Tab chọn · ↑↓ di chuyển · Esc đóng</Text>
        </Box>
      ) : null}

      <InputBox
        value={input.value}
        cursor={input.cursor}
        columns={columns}
        busy={busy}
        placeholder={busy ? 'Nhập để xếp hàng tin nhắn…' : 'Nhập yêu cầu cho PillAgents…'}
        maxLines={MAX_PROMPT_LINES}
      />

      <Box justifyContent="space-between">
        <Text dimColor wrap="truncate-end">
          {version} · {config.model}
          {config.effort ? <Text dimColor> · {config.effort}</Text> : null}
          {tokenUsage.last > 0 ? (
            <Text>
              {' · '}
              <Text color="magenta">↑{formatTokens(tokenUsage.prompt)}</Text>
              <Text dimColor> </Text>
              <Text color="cyan">↓{formatTokens(tokenUsage.completion)}</Text>
            </Text>
          ) : null}
          {busy ? <Text color="yellow"> · ● đang xử lý (Esc huỷ)</Text> : null}
          {queue.length > 0 ? <Text color="cyan"> · ⏳ {queue.length} chờ</Text> : null}
        </Text>
        <Text dimColor wrap="truncate-end">
          {scrolled
            ? `↑ đã cuộn ${maxTop - top} dòng · PageDown về cuối`
            : busy
              ? 'Esc huỷ'
              : 'Enter gửi · \\ + Enter xuống dòng · /help'}
        </Text>
      </Box>
    </Box>
  );
}
