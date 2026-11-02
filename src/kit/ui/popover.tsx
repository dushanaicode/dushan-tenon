// Adapted from shadcn/ui (MIT):
// apps/v4/registry/new-york-v4/ui/popover.tsx
// Source: shadcn-ui/ui d2fba50ee5b9113008b5bb908563527b7efd2f27.
// Semantic kit tokens and motion. License: ./LICENSE.
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type PopoverProps = ComponentProps<typeof PopoverPrimitive.Root>;
export type PopoverTriggerProps = ComponentProps<
  typeof PopoverPrimitive.Trigger
>;
export type PopoverContentProps = ComponentProps<
  typeof PopoverPrimitive.Content
>;
export type PopoverAnchorProps = ComponentProps<typeof PopoverPrimitive.Anchor>;

export function Popover(props: PopoverProps) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function PopoverTrigger({ className, ...props }: PopoverTriggerProps) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        data-motion-item
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "kit-pop kit-edge-stack z-50 w-72 rounded-lg border border-border",
          "origin-(--radix-popover-content-transform-origin)",
          "bg-popover p-4 text-popover-foreground shadow-popover",
          "focus-visible:outline-none",
          className,
        )}
        {...props}
        data-kit="popover"
      />
    </PopoverPrimitive.Portal>
  );
}

export function PopoverAnchor({ className, ...props }: PopoverAnchorProps) {
  return (
    <PopoverPrimitive.Anchor
      data-slot="popover-anchor"
      className={cn(className)}
      {...props}
    />
  );
}
