// Tính dòng ANSI và bản đồ chủ sở hữu từng dòng, có cache theo id mục transcript.
import { useCallback, useMemo, useRef } from 'react';
import { itemToLines, type TranscriptItem } from './Transcript.js';
import type { LineOwner } from './hitTest.js';

export function useTranscriptLines(options: {
  items: TranscriptItem[];
  streaming: string;
  thinkingLive: string;
  columns: number;
}): { lines: string[]; owners: LineOwner[]; invalidate: (id?: number) => void } {
  const { items, streaming, thinkingLive, columns } = options;
  const cacheRef = useRef(new Map<number, string[]>());
  const widthRef = useRef(columns);

  // Xoá cache của một mục, hoặc toàn bộ khi không truyền id.
  const invalidate = useCallback((id?: number) => {
    if (id === undefined) cacheRef.current.clear();
    else cacheRef.current.delete(id);
  }, []);

  const { lines, owners } = useMemo(() => {
    const cache = cacheRef.current;
    // Bề rộng đổi thì dòng đã cache sai wrap: phải xoá ngay trong lúc tính, vì effect
    // chạy sau khi memo đã đọc cache cũ và không kích hoạt render lại.
    if (widthRef.current !== columns) {
      cache.clear();
      widthRef.current = columns;
    }

    const output: string[] = [];
    const lineOwners: LineOwner[] = [];
    for (const item of items) {
      let rendered = cache.get(item.id);
      if (!rendered) {
        rendered = itemToLines(item, columns);
        cache.set(item.id, rendered);
      }
      const clickable = item.kind === 'thinking' || item.kind === 'tool';
      rendered.forEach((line, index) => {
        output.push(line);
        lineOwners.push({ id: item.id, kind: item.kind, header: clickable && index === 0 });
      });
    }

    if (thinkingLive) {
      const live = itemToLines({ id: -2, kind: 'thinking', text: thinkingLive }, columns);
      for (const line of live) {
        output.push(line);
        lineOwners.push({ id: -2, kind: 'thinking', header: false });
      }
    }
    if (streaming) {
      const live = itemToLines({ id: -1, kind: 'assistant', text: streaming }, columns);
      const body = live.slice(0, -1);
      for (const line of body) {
        output.push(line);
        lineOwners.push({ id: -1, kind: 'assistant', header: false });
      }
      output.push('  ▌');
      lineOwners.push({ id: -1, kind: 'assistant', header: false });
    }
    return { lines: output, owners: lineOwners };
  }, [items, streaming, thinkingLive, columns]);

  return { lines, owners, invalidate };
}
