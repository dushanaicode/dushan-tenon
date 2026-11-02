// 套件自写；许可见项目根 LICENSE。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KeyValueItem = {
  key: string;
  label: ReactNode;
  value: ReactNode;
};

export type KeyValueListProps = {
  items: readonly KeyValueItem[];
  columns?: 1 | 2;
  className?: string;
};

export function KeyValueList({
  items,
  columns = 1,
  className,
}: KeyValueListProps) {
  return (
    <dl
      data-slot="key-value-list"
      className={cn(
        "grid gap-stack text-body",
        columns === 2 && "sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.key}
          data-slot="key-value-item"
          className="grid min-w-0 grid-cols-[6rem_1fr] gap-3"
        >
          <dt data-part="label" className="text-muted-foreground">
            {item.label}
          </dt>
          <dd data-part="value" className="min-w-0 break-words">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
