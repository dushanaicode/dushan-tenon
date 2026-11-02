import type { CSSProperties } from "react";
import { VirtualList, type VirtualListProps } from "./virtual-list";

export type VirtualLogProps = {
  label: string;
  lines: readonly string[];
  height?: CSSProperties["height"];
  region?: VirtualListProps<string>["region"];
};

export function VirtualLog({
  label,
  lines,
  height = 320,
  region,
}: VirtualLogProps) {
  return (
    <VirtualList
      label={label}
      items={lines}
      height={height}
      region={region}
      estimateSize={28}
      getKey={(_, index) => index}
      renderItem={(line, index) => (
        <div className="flex min-w-0 gap-3 px-3 py-1 font-mono text-sm leading-5">
          <span
            aria-hidden="true"
            className="w-12 shrink-0 text-right text-muted-foreground tabular-nums select-none"
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {line || "\u00a0"}
          </span>
        </div>
      )}
    />
  );
}
