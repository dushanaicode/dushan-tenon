// 套件自写；许可见项目根 LICENSE。
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type CollapsibleProps = ComponentProps<typeof CollapsiblePrimitive.Root>;
export type CollapsibleTriggerProps = ComponentProps<
  typeof CollapsiblePrimitive.Trigger
>;
export type CollapsibleContentProps = ComponentProps<
  typeof CollapsiblePrimitive.Content
>;

export function Collapsible({ className, ...props }: CollapsibleProps) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={cn("min-w-0", className)}
      {...props}
      data-kit="collapsible"
    />
  );
}
export function CollapsibleTrigger({
  className,
  ...props
}: CollapsibleTriggerProps) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "min-h-control rounded-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
export function CollapsibleContent({
  className,
  ...props
}: CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      data-motion-item
      className={cn(
        "kit-collapse overflow-hidden text-body break-words",
        "[--kit-content-height:var(--radix-collapsible-content-height)]",
        className,
      )}
      {...props}
    />
  );
}
