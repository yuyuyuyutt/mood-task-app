// src/hooks/useWindowedList.ts
// 轻量窗口化列表：当条目数超过 threshold 时，只渲染视口附近的行，
// 其余用上下 padding 撑出滚动高度。滚动事件经 rAF 节流，避免高频 setState。
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface WindowedListOptions {
  /** 每行估算高度（px）；启用窗口化后行使用固定高度 */
  itemHeight: number;
  /** 视口外上下各多渲染的行数 */
  overscan?: number;
  /** 条目数超过该值才启用窗口化 */
  threshold?: number;
}

export function useWindowedList<T>(
  items: readonly T[],
  { itemHeight, overscan = 8, threshold = 60 }: WindowedListOptions,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, 40) });

  const windowed = items.length > threshold;

  const updateRange = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewport = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((scrollTop + viewport) / itemHeight) + overscan);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [items.length, itemHeight, overscan]);

  useLayoutEffect(() => {
    updateRange();
    if (!windowed) {
      setRange({ start: 0, end: items.length });
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updateRange();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [windowed, items.length, updateRange]);

  const slice = windowed ? items.slice(range.start, range.end) : items;
  const padTop = windowed ? range.start * itemHeight : 0;
  const padBottom = windowed ? (items.length - range.end) * itemHeight : 0;

  return { containerRef, windowed, slice, padTop, padBottom, itemHeight };
}
