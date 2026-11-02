// 套件自写；许可见项目根 LICENSE。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TimelineTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";
export type TimelineItem = {
  id: string;
  title: ReactNode;
  time?: ReactNode;
  description?: ReactNode;
  tone?: TimelineTone;
};
export type TimelineProps = {
  items: readonly TimelineItem[];
  className?: string;
};

const tones = {
  neutral: "bg-muted-foreground",
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol data-slot="timeline" className={cn("flex flex-col", className)}>
      {items.map((item, index) => (
        <li
          key={item.id}
          data-slot="timeline-item"
          className="relative flex gap-3 pb-(--stack-gap) last:pb-0"
        >
          {index < items.length - 1 && (
            <span
              data-slot="timeline-connector"
              aria-hidden="true"
              className="absolute top-2.5 left-1 h-full w-px bg-border"
            />
          )}
          <span
            data-slot="timeline-dot"
            aria-hidden="true"
            className={cn(
              "relative mt-1.5 size-2 shrink-0 rounded-full",
              tones[item.tone ?? "neutral"],
            )}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <div data-part="title" className="text-body">
              {item.title}
            </div>
            {item.time != null && (
              <div data-part="time" className="text-sm text-muted-foreground">
                {item.time}
              </div>
            )}
            {item.description != null && (
              <div
                data-part="description"
                className="text-sm text-muted-foreground"
              >
                {item.description}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
