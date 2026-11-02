// Adapted from shadcn/ui's MIT-licensed new-york-v4 Tooltip (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type TooltipProviderProps = ComponentProps<
  typeof TooltipPrimitive.Provider
>;
export type TooltipProps = ComponentProps<typeof TooltipPrimitive.Root>;
export type TooltipTriggerProps = ComponentProps<
  typeof TooltipPrimitive.Trigger
>;
export type TooltipContentProps = ComponentProps<
  typeof TooltipPrimitive.Content
>;

export function TooltipProvider({
  delayDuration = 300,
  ...props
}: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

export function Tooltip({ ...props }: TooltipProps) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

export function TooltipTrigger({ ...props }: TooltipTriggerProps) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        data-motion-item
        sideOffset={sideOffset}
        className={cn(
          "kit-pop z-50 w-fit rounded-md bg-foreground px-3 py-1.5",
          "origin-(--radix-tooltip-content-transform-origin)",
          "text-xs text-balance text-background",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
