// Giao diện PillAgents: header capsule, transcript markdown, thẻ tool, xếp hàng và hộp duyệt.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, measureElement, useApp, useWindowSize, type DOMElement } from 'ink';
import { Agent } from '../agent.js';
import { EFFORT_LEVELS, parseEffort, type Config } from '../config.js';
import type { ToolState } from '../tools.js';
import type { AgentMode, ToolCall, ToolResult, Usage } from '../types.js';
import { runStatusLine, type StatusLineInput } from '../statusline.js';
import { InputBox, countInputLines, reduceInput, reduceString, type InputState } from './InputBox.js';
import { applySuggestion, suggestCommands } from './commands.js';
import { summarizeToolCall, type ItemBody, type TranscriptItem } from './Transcript.js';
import { useKeys, type KeyEvent } from './useKeys.js';
import { useTranscriptLines } from './useTranscriptLines.js';
import { Header } from './Header.js';
import { StatusBar } from './StatusBar.js';
import { Welcome } from './Welcome.js';
import { QueuePanel, queuePanelHeight } from './QueuePanel.js';
import { ApprovalPanel } from './ApprovalPanel.js';
import { buildApprovalLines, canAutoApproveBash, canTrustBash } from './approval.js';
import { readGitBranch } from './git.js';
import { hitTestColumn, hitTestLine } from './hitTest.js';
import { SPINNER_FRAMES } from './format.js';
import { COLORS, GLYPHS } from './theme.js';

type PendingApproval = { call: ToolCall; resolve: (approved: boolean) => void };

const MAX_PROMPT_LINES = 8;
const STREAM_FLUSH_MS = 60;
const STATUS_DEBOUNCE_MS = 150;
const SPINNER_INTERVAL_MS = 120;
const WHEEL_LINES = 3;
const HEADER_HEIGHT = 2;
const FOOTER_HEIGHT = 1;

// Màn hình chính của PillAgents.
export function App({
  agent,
  config,
  version,
  toolState,
}: {
  agent: Agent;
  config: Config;
  version: string;
  toolState: ToolState;
}): React.ReactElement {
  const { exit } = useApp();
  const size = useWindowSize();
  const columns = Math.max(20, size.columns || 80);
  const rows = Math.max(10, size.rows || 24);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [mode, setModeState] = useState<AgentMode>(config.mode);
  const [streaming, setStreaming] = useState('');
  const [thinkingLive, setThinkingLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [approvalExpanded, setApprovalExpanded] = useState(false);
  const [bashTrusted, setBashTrusted] = useState(false);
  const [scrollTop, setScrollTop] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [tokenUsage, setTokenUsage] = useState({ prompt: 0, completion: 0, last: 0 });
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [input, setInput] = useState<InputState>({ value: '', cursor: 0, historyIndex: -1 });
  const [statusText, setStatusText] = useState<string | undefined>(undefined);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [gitBranch] = useState(() => readGitBranch(config.cwd));

  const idRef = useRef(0);
  const textRef = useRef('');
  const thinkingRef = useRef('');
  const thinkingStartRef = useRef<number | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<DOMElement | null>(null);
  // Bản sao state cho handler bất đồng bộ: cập nhật ngay tại chỗ ghi state, không qua
  // useEffect, để tránh ghi đè bằng giá trị cũ khi có nhiều cập nhật trong cùng một frame.
  const pendingRef = useRef<PendingApproval | null>(null);
  const busyRef = useRef(false);
  const bashTrustRef = useRef(false);
  const inputRef = useRef(input);
  const modeRef = useRef(config.mode);
  const scrollRef = useRef<number | null>(null);
  const queueRef = useRef<string[]>([]);
  const submitRef = useRef<((text: string) => void) | null>(null);

  const { lines, owners, invalidate } = useTranscriptLines({ items, streaming, thinkingLive, columns });

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
  const setBashTrustSync = useCallback((value: boolean) => {
    bashTrustRef.current = value;
    setBashTrusted(value);
  }, []);
  const setScrollSync = useCallback((value: number | null) => {
    scrollRef.current = value;
    setScrollTop(value);
  }, []);
  const setMode = useCallback(
    (next: AgentMode) => {
      modeRef.current = next;
      config.mode = next;
      setModeState(next);
    },
    [config],
  );
  const toggleMode = useCallback(() => {
    if (busyRef.current) return;
    setMode(modeRef.current === 'plan' ? 'build' : 'plan');
  }, [setMode]);

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

  // Dừng lượt đang chạy, từ chối tool đang chờ và giữ hàng đợi để chạy tiếp.
  const abort = useCallback(() => {
    controllerRef.current?.abort();
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
      setPendingSync(null);
      setApprovalExpanded(false);
    }
    commitThinking();
    commitStreaming();
  }, [commitThinking, commitStreaming, setPendingSync]);

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
      setTurnStartedAt(Date.now());
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
                invalidate(item.id);
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
            // Lệnh bash thường đã được tin cậy trong phiên thì chạy luôn; lệnh nguy hiểm
            // vẫn đi qua hộp duyệt vì canAutoApproveBash trả false.
            if (canAutoApproveBash(call, bashTrustRef.current)) {
              resolve(true);
              return;
            }
            setApprovalExpanded(false);
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
        setApprovalExpanded(false);
        controllerRef.current = null;
        setBusySync(false);
        setTurnStartedAt(null);

        const next = queueRef.current.shift();
        if (next) {
          setQueue([...queueRef.current]);
          // Đi qua submit để lệnh gạch chéo xếp hàng được thực thi như lệnh, không gửi cho model.
          setTimeout(() => submitRef.current?.(next), 0);
        }
      }
    },
    [agent, commitStreaming, commitThinking, flushNow, invalidate, pushItem, scheduleFlush, setBusySync, setPendingSync, setScrollSync],
  );

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
        const wasTrusted = bashTrustRef.current;
        agent.reset();
        toolState.readFiles.clear();
        setItems([]);
        invalidate();
        setBashTrustSync(false);
        setTokenUsage({ prompt: 0, completion: 0, last: 0 });
        setScrollSync(null);
        pushItem({
          kind: 'info',
          text: wasTrusted ? 'Đã xoá hội thoại và tắt tự duyệt bash.' : 'Đã xoá hội thoại.',
        });
        return true;
      }
      if (command === '/plan' || command === '/build') {
        const next: AgentMode = command === '/plan' ? 'plan' : 'build';
        const label = next === 'plan' ? 'plan (chỉ đọc)' : 'build (đầy đủ tool)';
        if (modeRef.current === next) {
          pushItem({ kind: 'info', text: `Đang ở chế độ ${label}.` });
        } else {
          setMode(next);
          pushItem({ kind: 'info', text: `Đã chuyển sang chế độ ${label}.` });
        }
        return true;
      }
      if (command === '/mode') {
        pushItem({
          kind: 'info',
          text: `Chế độ hiện tại: ${modeRef.current === 'plan' ? 'plan (chỉ đọc)' : 'build (đầy đủ tool)'}`,
        });
        return true;
      }
      if (command === '/trust') {
        const value = rest.join(' ').trim().toLowerCase();
        if (!value) {
          pushItem({
            kind: 'info',
            text: `Tự duyệt bash: ${bashTrustRef.current ? 'bật' : 'tắt'}. Dùng /trust on|off để đổi.`,
          });
          return true;
        }
        if (value === 'on') {
          setBashTrustSync(true);
          pushItem({
            kind: 'info',
            text: 'Đã bật tự duyệt bash. Lệnh nguy hiểm vẫn hỏi; /trust off để tắt.',
          });
          return true;
        }
        if (value === 'off') {
          setBashTrustSync(false);
          pushItem({ kind: 'info', text: 'Đã tắt tự duyệt bash.' });
          return true;
        }
        pushItem({ kind: 'error', text: `Giá trị không hợp lệ: ${value}. Dùng /trust on hoặc /trust off.` });
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
          text: 'Enter gửi • Tab đổi chế độ plan/build • \\ + Enter hoặc Ctrl+J xuống dòng • ↑/↓ lịch sử lệnh • PageUp/PageDown cuộn • lăn chuột cuộn • Esc huỷ lượt • Ctrl+C xoá input/thoát • Ctrl+O mở/đóng thinking • Ctrl+T mở/đóng kết quả tool • click tiêu đề Thinking/tool để mở/đóng • a (khi chờ duyệt bash) tự duyệt cả phiên • Ctrl+D thoát • /plan /build /mode /clear /trust /model /effort /help /exit',
        });
        return true;
      }
      pushItem({ kind: 'error', text: `Lệnh không hỗ trợ: ${command}` });
      return true;
    },
    [agent, config, exit, invalidate, pushItem, setBashTrustSync, setMode, setScrollSync],
  );

  // Gửi tin nhắn: chạy ngay nếu rảnh, xếp hàng nếu đang bận.
  const submit = useCallback(
    (text: string) => {
      if (busyRef.current) {
        queueRef.current.push(text);
        setQueue([...queueRef.current]);
        return;
      }
      if (runCommand(text)) return;
      void runTurn(text);
    },
    [runCommand, runTurn],
  );
  submitRef.current = submit;

  // Mở/đóng toàn bộ khối thinking, xoá cache để render lại.
  const toggleThinking = useCallback(() => {
    invalidate();
    setItems((current) => {
      const thinking = current.filter((item) => item.kind === 'thinking');
      if (!thinking.length) return current;
      const expand = thinking.some((item) => item.kind === 'thinking' && item.expanded === false);
      return current.map((item) =>
        item.kind === 'thinking' ? { ...item, expanded: expand } : item,
      );
    });
  }, [invalidate]);

  // Mở/đóng riêng một khối thinking theo id.
  const toggleThinkingItem = useCallback(
    (id: number) => {
      invalidate(id);
      setItems((current) =>
        current.map((item) =>
          item.kind === 'thinking' && item.id === id
            ? { ...item, expanded: item.expanded !== true }
            : item,
        ),
      );
    },
    [invalidate],
  );

  // Mở/đóng toàn bộ kết quả tool.
  const toggleTools = useCallback(() => {
    invalidate();
    setItems((current) => {
      const tools = current.filter((item) => item.kind === 'tool');
      if (!tools.length) return current;
      const expand = tools.some((item) => item.kind === 'tool' && item.expanded !== true);
      return current.map((item) => (item.kind === 'tool' ? { ...item, expanded: expand } : item));
    });
  }, [invalidate]);

  // Mở/đóng riêng kết quả của một tool theo id.
  const toggleToolItem = useCallback(
    (id: number) => {
      invalidate(id);
      setItems((current) =>
        current.map((item) =>
          item.kind === 'tool' && item.id === id
            ? { ...item, expanded: item.expanded !== true }
            : item,
        ),
      );
    },
    [invalidate],
  );

  const suggestions = useMemo(() => suggestCommands(input.value), [input.value]);
  const activeSuggestion = suggestions.length ? suggestions[Math.min(suggestionIndex, suggestions.length - 1)] : null;
  const toolCount = useMemo(
    () => items.reduce((count, item) => (item.kind === 'tool' ? count + 1 : count), 0),
    [items],
  );

  // Dòng trạng thái mặc định, dùng khi người dùng chưa cấu hình statusLine.
  const builtinStatus = `${version} · ${config.model}${config.effort ? ` · ${config.effort}` : ''}`;

  // Gói mọi thứ lệnh statusLine nhận được vào một chuỗi để effect chạy lại đúng lúc.
  const statusCommand = config.statusLine?.command;
  const statusSignature = [
    statusCommand ?? '',
    builtinStatus,
    mode,
    tokenUsage.prompt,
    tokenUsage.completion,
    busy,
    queue.length,
  ].join('|');

  // Chạy lệnh statusLine sau khi trạng thái phiên đổi, gộp các lần đổi liền nhau. Mọi giá trị
  // effect đọc đều nằm trong statusSignature nên chỉ cần nó trong danh sách phụ thuộc.
  useEffect(() => {
    if (!statusCommand) {
      setStatusText(undefined);
      return;
    }
    const input: StatusLineInput = {
      version,
      model: config.model,
      effort: config.effort,
      mode,
      cwd: config.cwd,
      tokens: { prompt: tokenUsage.prompt, completion: tokenUsage.completion },
      busy,
      queued: queue.length,
    };
    let cancelled = false;
    const timer = setTimeout(() => {
      void runStatusLine({ command: statusCommand, cwd: config.cwd, input }).then((line) => {
        if (!cancelled) setStatusText(line);
      });
    }, STATUS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [statusSignature]);

  // Quay spinner trong lúc agent chạy; dừng hẳn khi rảnh để không render thừa. Khung hình không
  // nằm trong statusSignature nên lệnh statusLine không bị chạy lại theo nhịp spinner.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      setSpinnerFrame((frame) => (frame + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [busy]);

  const inputLines = countInputLines(input.value, input.cursor, columns, MAX_PROMPT_LINES);
  const suggestionHeight = suggestions.length ? suggestions.length + 1 : 0;
  const queueLimit = rows >= 30 ? 3 : 2;
  const queueHeight = queuePanelHeight(queue, queueLimit);
  const baseChromeHeight = HEADER_HEIGHT + queueHeight + suggestionHeight + inputLines + FOOTER_HEIGHT;
  const approvalBudget = Math.max(4, rows - 3 - baseChromeHeight - 2);
  const approvalMaxPreview = Math.max(1, Math.min(approvalExpanded ? 24 : 8, approvalBudget - 4));
  const approvalLines = useMemo(
    () =>
      pendingApproval
        ? buildApprovalLines(pendingApproval.call, {
            width: Math.max(10, columns - 4),
            expanded: approvalExpanded,
            cwd: config.cwd,
            maxPreview: approvalMaxPreview,
          })
        : [],
    [pendingApproval, approvalExpanded, columns, config.cwd, approvalMaxPreview],
  );
  const chromeHeight = baseChromeHeight + (pendingApproval ? approvalLines.length + 2 : 0);
  const viewportHeight = Math.max(3, rows - chromeHeight);
  const maxTop = Math.max(0, lines.length - viewportHeight);
  const top = scrollTop === null ? maxTop : Math.min(Math.max(0, scrollTop), maxTop);
  const visible = lines.slice(top, top + viewportHeight);
  const scrolledLines = maxTop > 0 ? maxTop - top : 0;
  const showWelcome = items.length === 0 && !streaming && !thinkingLive;

  // Cuộn transcript theo số dòng, chỉ khi nội dung tràn màn hình.
  const scrollBy = useCallback(
    (delta: number) => {
      if (maxTop <= 0) return;
      const current = scrollRef.current === null ? maxTop : Math.min(scrollRef.current, maxTop);
      const next = Math.max(0, Math.min(maxTop, current + delta));
      setScrollSync(next >= maxTop ? null : next);
    },
    [maxTop, setScrollSync],
  );

  // Click vào dòng tiêu đề thinking/tool để mở/đóng đúng mục đó.
  const handleClick = useCallback(
    (row: number, column: number) => {
      if (pendingRef.current) return;
      const node = transcriptRef.current;
      if (!node) return;
      const metrics = measureElement(node);
      if (metrics.width <= 0 || !hitTestColumn(column, metrics.x, metrics.width)) return;
      const owner = hitTestLine(owners, { top, transcriptTop: metrics.y, row, height: metrics.height });
      if (!owner?.header) return;
      if (owner.kind === 'thinking') toggleThinkingItem(owner.id);
      else if (owner.kind === 'tool') toggleToolItem(owner.id);
    },
    [owners, top, toggleThinkingItem, toggleToolItem],
  );

  // Xử lý sự kiện phím và chuột đã chuẩn hoá.
  const handleKey = useCallback(
    (event: KeyEvent) => {
      if (event.type === 'wheel') {
        scrollBy(event.direction === 'up' ? -WHEEL_LINES : WHEEL_LINES);
        return;
      }
      if (event.type === 'click') {
        handleClick(event.row, event.column);
        return;
      }

      // Khi chờ duyệt: y/n/Esc trả lời, a tự duyệt bash, d mở rộng, phím khác bị chặn.
      if (pendingRef.current) {
        const text = event.type === 'key' ? event.char : event.type === 'text' ? event.text : '';
        const answer = text.toLowerCase();
        const escape = event.type === 'key' && event.key.escape;
        const plain = event.type === 'text' || (event.type === 'key' && !event.key.ctrl && !event.key.meta);
        const entry = pendingRef.current;
        if (plain && answer === 'd') {
          setApprovalExpanded((current) => !current);
          return;
        }
        if (plain && answer === 'a' && canTrustBash(entry.call)) {
          setBashTrustSync(true);
          setPendingSync(null);
          setApprovalExpanded(false);
          entry.resolve(true);
          pushItem({
            kind: 'info',
            text: 'Đã bật tự duyệt bash. Lệnh nguy hiểm vẫn hỏi; /trust off để tắt.',
          });
          return;
        }
        if (answer === 'y' || answer === 'n' || escape) {
          setPendingSync(null);
          setApprovalExpanded(false);
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
      if (key.ctrl && char === 't') {
        toggleTools();
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

      // Tab đổi chế độ khi bảng gợi ý lệnh không mở; không đổi giữa lượt đang chạy.
      if (key.tab) {
        toggleMode();
        return;
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
    [
      abort,
      applyInput,
      exit,
      handleClick,
      history,
      pushItem,
      scrollBy,
      setBashTrustSync,
      setPendingSync,
      submit,
      suggestions,
      suggestionIndex,
      toggleMode,
      toggleThinking,
      toggleTools,
      viewportHeight,
    ],
  );

  useKeys(handleKey);

  const elapsedMs = turnStartedAt === null ? 0 : Date.now() - turnStartedAt;

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Header
        version={version}
        mode={mode}
        cwd={config.cwd}
        branch={gitBranch}
        columns={columns}
      />

      <Box ref={transcriptRef} flexDirection="column" height={viewportHeight} flexShrink={0} overflow="hidden">
        {showWelcome ? (
          <Welcome version={version} columns={columns} rows={rows} />
        ) : (
          visible.map((line, index) => (
            <Text key={index} wrap="truncate-end">
              {line || ' '}
            </Text>
          ))
        )}
      </Box>

      {queue.length ? <QueuePanel queue={queue} maxVisible={queueLimit} /> : null}
      {pendingApproval ? <ApprovalPanel lines={approvalLines} columns={columns} /> : null}

      {suggestions.length ? (
        <Box flexDirection="column" paddingX={1} flexShrink={0}>
          {suggestions.map((command, index) => {
            const active = command === activeSuggestion;
            return (
              <Text key={command.name} wrap="truncate-end">
                <Text color={active ? COLORS.accent : undefined} bold={active}>
                  {active ? `${GLYPHS.prompt} ` : '  '}
                </Text>
                <Text color={active ? COLORS.accent : undefined} bold={active}>
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
        mode={mode}
        placeholder={
          busy
            ? 'Nhập để xếp hàng tin nhắn…'
            : mode === 'plan'
              ? 'Mô tả điều cần khảo sát và lập kế hoạch…'
              : 'Nhập yêu cầu cho PillAgents…'
        }
        maxLines={MAX_PROMPT_LINES}
      />

      <StatusBar
        version={version}
        mode={mode}
        model={config.model}
        effort={config.effort}
        tokens={tokenUsage}
        toolCount={toolCount}
        elapsedMs={busy ? elapsedMs : 0}
        busy={busy}
        queueCount={queue.length}
        bashTrusted={bashTrusted}
        statusText={statusText}
        spinnerFrame={spinnerFrame}
        scrolledLines={scrolledLines}
        columns={columns}
      />
    </Box>
  );
}
