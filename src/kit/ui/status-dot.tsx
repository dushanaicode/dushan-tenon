// 套件自写。
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type StatusDotProps = ComponentProps<"span"> & {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  running?: boolean;
};

const tones = {
  neutral: "bg-muted-foreground",
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export function StatusDot({
  tone = "info",
  running = false,
  className,
  ...props
}: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      data-motion-item={running || undefined}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tones[tone],
        running && "kit-pulse",
        className,
      )}
      {...props}
      aria-hidden="true"
    />
  );
}
