// 套件自写；许可见项目根 LICENSE。
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ToggleGroupProps = ComponentProps<typeof ToggleGroupPrimitive.Root>;
export type ToggleGroupItemProps = ComponentProps<
  typeof ToggleGroupPrimitive.Item
>;

export function ToggleGroup({ className, ...props }: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
      data-kit="toggle-group"
    />
  );
}
export function ToggleGroupItem({ className, ...props }: ToggleGroupItemProps) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "relative inline-flex min-h-control min-w-(--control-h) max-w-full items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-body font-medium break-words",
        "hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:font-bold",
        "data-[state=on]:outline-2 data-[state=on]:outline-solid data-[state=on]:outline-offset-[-3px]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-50 kit-icon-control",
        "forced-colors:data-[state=on]:bg-[Highlight]! forced-colors:data-[state=on]:text-[HighlightText]!",
        "forced-colors:data-[state=on]:[forced-color-adjust:preserve-parent-color]",
        "forced-colors:hover:bg-[Highlight]! forced-colors:hover:text-[HighlightText]! forced-colors:hover:[forced-color-adjust:preserve-parent-color]",
        className,
      )}
      {...props}
    />
  );
}
