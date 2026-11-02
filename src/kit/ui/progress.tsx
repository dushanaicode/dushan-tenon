// Adapted from shadcn/ui's MIT-licensed new-york-v4 Progress (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type ProgressProps = ComponentProps<typeof ProgressPrimitive.Root>;

export function Progress({
  className,
  value,
  max = 100,
  ...props
}: ProgressProps) {
  const offset = value == null ? 65 : 100 - (value / max) * 100;
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn(
        "relative h-2 w-full overflow-clip rounded-full bg-muted",
        "forced-colors:border forced-colors:border-[CanvasText]",
        "forced-colors:[&_[data-slot=progress-indicator]]:bg-[Highlight]",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-motion-item
        className={cn(
          "h-full w-full flex-1 bg-primary",
          value == null ? "kit-pulse" : "motion-transform",
        )}
        style={
          {
            transform: `var(--progress-transform, translateX(-${offset}%))`,
            "--progress-visible": `${100 - offset}%`,
          } as CSSProperties
        }
      />
    </ProgressPrimitive.Root>
  );
}
