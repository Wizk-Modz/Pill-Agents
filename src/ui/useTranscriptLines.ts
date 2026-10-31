// Tính dòng ANSI và bản đồ chủ sở hữu từng dòng, có cache theo id mục transcript.
import { useCallback, useMemo, useRef } from 'react';
import { itemToLines, type TranscriptItem } from './Transcript.js';
import type { LineOwner } from './hitTest.js';
import { visibleWidth } from './format.js';
import { paintSegments } from './markdown.js';
import { COLORS, GLYPHS } from './theme.js';

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
      const headerIndex = clickable ? rendered.findIndex((line) => line.length > 0) : -1;
      rendered.forEach((line, index) => {
        output.push(line);
        lineOwners.push({ id: item.id, kind: item.kind, header: clickable && index === headerIndex });
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
      // Gắn con trỏ vào cuối dòng cuối nếu còn chỗ, tránh che mất dòng vừa stream.
      const cursor = paintSegments([{ text: ` ${GLYPHS.cursor}`, color: COLORS.accent }]);
      const last = live[live.length - 1];
      if (last !== undefined && visibleWidth(last) + 2 <= columns) {
        live[live.length - 1] = last + cursor;
      } else {
        live.push(`  ${cursor}`);
      }
      for (const line of live) {
        output.push(line);
        lineOwners.push({ id: -1, kind: 'assistant', header: false });
      }
    }
    return { lines: output, owners: lineOwners };
  }, [items, streaming, thinkingLive, columns]);

  return { lines, owners, invalidate };
}
