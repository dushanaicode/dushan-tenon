// 套件自写；许可见项目根 LICENSE。
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type HoverCardProps = ComponentProps<typeof HoverCardPrimitive.Root>;
export type HoverCardTriggerProps = ComponentProps<
  typeof HoverCardPrimitive.Trigger
>;
export type HoverCardContentProps = ComponentProps<
  typeof HoverCardPrimitive.Content
>;

export function HoverCard({
  openDelay = 150,
  closeDelay = 200,
  ...props
}: HoverCardProps) {
  return (
    <HoverCardPrimitive.Root
      data-slot="hover-card"
      openDelay={openDelay}
      closeDelay={closeDelay}
      {...props}
    />
  );
}
export function HoverCardTrigger({
  className,
  ...props
}: HoverCardTriggerProps) {
  return (
    <HoverCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      className={cn(className)}
      {...props}
    />
  );
}
export function HoverCardContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        data-motion-item
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "kit-pop kit-edge-stack z-50 w-72 max-w-(--radix-hover-card-content-available-width) rounded-lg border border-border",
          "origin-(--radix-hover-card-content-transform-origin)",
          "bg-popover p-4 text-popover-foreground shadow-popover",
          "break-words focus-visible:outline-none",
          className,
        )}
        {...props}
        data-kit="hover-card"
      />
    </HoverCardPrimitive.Portal>
  );
}
