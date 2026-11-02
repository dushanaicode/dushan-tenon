// Adapted from shadcn/ui's MIT-licensed new-york-v4 Select (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export type SelectProps = ComponentProps<typeof SelectPrimitive.Root>;
export type SelectGroupProps = ComponentProps<typeof SelectPrimitive.Group>;
export type SelectValueProps = ComponentProps<typeof SelectPrimitive.Value>;
export type SelectTriggerProps = ComponentProps<typeof SelectPrimitive.Trigger>;
export type SelectContentProps = ComponentProps<typeof SelectPrimitive.Content>;
export type SelectLabelProps = ComponentProps<typeof SelectPrimitive.Label>;
export type SelectItemProps = ComponentProps<typeof SelectPrimitive.Item>;
export type SelectSeparatorProps = ComponentProps<
  typeof SelectPrimitive.Separator
>;

export function Select({ ...props }: SelectProps) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

export function SelectGroup({ ...props }: SelectGroupProps) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

export function SelectValue({ ...props }: SelectValueProps) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-control w-fit items-center justify-between gap-2",
        "rounded-md border border-input bg-transparent px-3 py-2 text-body",
        "whitespace-nowrap focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive",
        "data-[placeholder]:text-muted-foreground",
        "*:data-[slot=select-value]:line-clamp-1",
        "*:data-[slot=select-value]:flex",
        "*:data-[slot=select-value]:items-center",
        "*:data-[slot=select-value]:gap-2",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        "kit-icon-control",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <Icon iconId="expand" className="text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  sideOffset = 4,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-motion-item
        className={cn(
          "kit-pop relative z-50 min-w-32 overflow-hidden",
          "max-h-(--radix-select-content-available-height)",
          "origin-(--radix-select-content-transform-origin)",
          "rounded-lg border border-border bg-popover",
          "text-popover-foreground shadow-popover",
          "focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton
          data-slot="select-scroll-up-button"
          className="flex cursor-default items-center justify-center py-1"
        >
          <Icon iconId="collapse" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" && [
              "h-[var(--radix-select-trigger-height)] w-full",
              "min-w-[var(--radix-select-trigger-width)] scroll-my-1",
            ],
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton
          data-slot="select-scroll-down-button"
          className="flex cursor-default items-center justify-center py-1"
        >
          <Icon iconId="expand" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: SelectLabelProps) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-control w-full cursor-default items-center",
        "gap-2 rounded-sm py-1.5 pr-8 pl-2 text-body select-none",
        "focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "data-[highlighted]:bg-accent",
        "data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        "kit-icon-control",
        "*:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <Icon iconId="selected" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
