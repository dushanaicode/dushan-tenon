// Thin wrapper around TanStack Virtual (MIT); the caller owns each row's content.
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { ScrollArea, type ScrollAreaProps } from "./scroll-area";

export type VirtualListProps<T> = {
  label: string;
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  height?: CSSProperties["height"];
  estimateSize?: number;
  className?: string;
  region?: ScrollAreaProps["region"];
};

export function VirtualList<T>({
  label,
  items,
  getKey,
  renderItem,
  height = 320,
  estimateSize = 36,
  className,
  region = "auxiliary",
}: VirtualListProps<T>) {
  const scroll = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | number | null>(null);
  const focused = useMemo(
    () =>
      focusedKey === null
        ? -1
        : items.findIndex((item, index) => getKey(item, index) === focusedKey),
    [items, getKey, focusedKey],
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getKey(items[index], index),
    overscan: 6,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      return focused >= 0 && !visible.includes(focused)
        ? [...visible, focused].sort((a, b) => a - b)
        : visible;
    },
  });
  return (
    <ScrollArea
      role="region"
      region={region}
      ref={scroll}
      data-slot="virtual-list"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "overscroll-contain rounded-md border border-border bg-card text-card-foreground",
        className,
      )}
      style={{ height }}
      onFocusCapture={(event) => {
        const row = event.target.closest<HTMLElement>("[data-virtual-index]");
        const index = row ? Number(row.dataset.virtualIndex) : -1;
        setFocusedKey(index >= 0 ? getKey(items[index], index) : null);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocusedKey(null);
      }}
    >
      <ul
        aria-label={label}
        className="relative m-0 w-full list-none p-0"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => (
          <li
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            data-virtual-index={row.index}
            aria-posinset={row.index + 1}
            aria-setsize={items.length}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {renderItem(items[row.index], row.index)}
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
