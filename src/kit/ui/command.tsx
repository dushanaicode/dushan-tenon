// Adapted from shadcn/ui's MIT-licensed new-york-v4 Command
// (shadcn-ui/ui d2fba50); semantic kit tokens. License: ./LICENSE.
import { Command as CommandPrimitive } from "cmdk";
import { type ComponentProps, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  type DialogProps,
  DialogTitle,
} from "./dialog";
import { Icon } from "./icon";
import { ScrollArea } from "./scroll-area";

export type CommandProps = Omit<
  ComponentProps<typeof CommandPrimitive>,
  "vimBindings"
>;
export type CommandDialogProps = DialogProps & {
  title: string;
  description: string;
  className?: string;
};
export type CommandInputProps = ComponentProps<typeof CommandPrimitive.Input>;
export type CommandListProps = ComponentProps<typeof CommandPrimitive.List>;
export type CommandEmptyProps = ComponentProps<typeof CommandPrimitive.Empty>;
export type CommandGroupProps = ComponentProps<typeof CommandPrimitive.Group>;
export type CommandItemProps = ComponentProps<typeof CommandPrimitive.Item>;
export type CommandSeparatorProps = ComponentProps<
  typeof CommandPrimitive.Separator
>;
export type CommandShortcutProps = ComponentProps<"span">;

export function Command({ className, loop = true, ...props }: CommandProps) {
  return (
    <CommandPrimitive
      data-slot="command"
      loop={loop}
      className={cn(
        "kit-edge-stack flex h-full w-full flex-col rounded-md",
        "bg-popover text-popover-foreground",
        className,
      )}
      {...props}
      vimBindings={false}
    />
  );
}

export function CommandDialog({
  title,
  description,
  children,
  className,
  ...props
}: CommandDialogProps) {
  const previousFocus = useRef<Element | null>(null);
  return (
    <Dialog {...props}>
      <DialogContent
        data-command-dialog=""
        showCloseButton={false}
        className={cn("gap-0 p-0", className)}
        onOpenAutoFocus={() => {
          previousFocus.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          // 快捷键打开时没有 Radix Trigger，恢复打开前的焦点。
          event.preventDefault();
          if (previousFocus.current instanceof HTMLElement)
            previousFocus.current.focus();
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({ className, ...props }: CommandInputProps) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex items-center gap-2 border-b border-border px-3 py-2"
    >
      <Icon iconId="search" className="text-muted-foreground" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-control w-full rounded-md bg-transparent text-body",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  children,
  ...props
}: CommandListProps) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-80 scroll-py-1", className)}
      {...props}
      asChild
    >
      <ScrollArea>{children}</ScrollArea>
    </CommandPrimitive.List>
  );
}

export function CommandEmpty({ className, ...props }: CommandEmptyProps) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-body", className)}
      {...props}
    />
  );
}

export function CommandGroup({ className, ...props }: CommandGroupProps) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1",
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
        "[&_[cmdk-group-heading]]:text-xs",
        "[&_[cmdk-group-heading]]:font-medium",
        "[&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: CommandItemProps) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex min-h-control cursor-default items-center gap-2",
        "rounded-sm px-2 py-1.5 text-body select-none",
        "data-[selected=true]:bg-accent",
        "data-[selected=true]:text-accent-foreground",
        "data-[disabled=true]:pointer-events-none",
        "data-[disabled=true]:opacity-50",
        "focus-visible:outline-none",
        "kit-icon-control [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: CommandSeparatorProps) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: CommandShortcutProps) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
