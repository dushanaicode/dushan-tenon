// 套件自写；许可见项目根 LICENSE。
import { Check, ChevronRight, Circle } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import {
  menuContentLayoutClasses,
  menuContentSurfaceClasses,
  menuForcedColorsClasses,
  menuIndicatorClasses,
  menuItemClasses,
  menuLabelClasses,
  menuSeparatorClasses,
  menuShortcutClasses,
} from "./menu-classes";
import { ScrollArea } from "./scroll-area";

export type ContextMenuProps = ComponentProps<typeof ContextMenuPrimitive.Root>;
export type ContextMenuTriggerProps = ComponentProps<
  typeof ContextMenuPrimitive.Trigger
>;
export type ContextMenuContentProps = ComponentProps<
  typeof ContextMenuPrimitive.Content
>;
export type ContextMenuGroupProps = ComponentProps<
  typeof ContextMenuPrimitive.Group
>;
export type ContextMenuItemProps = ComponentProps<
  typeof ContextMenuPrimitive.Item
>;
export type ContextMenuCheckboxItemProps = ComponentProps<
  typeof ContextMenuPrimitive.CheckboxItem
>;
export type ContextMenuRadioGroupProps = ComponentProps<
  typeof ContextMenuPrimitive.RadioGroup
>;
export type ContextMenuRadioItemProps = ComponentProps<
  typeof ContextMenuPrimitive.RadioItem
>;
export type ContextMenuLabelProps = ComponentProps<
  typeof ContextMenuPrimitive.Label
>;
export type ContextMenuSeparatorProps = ComponentProps<
  typeof ContextMenuPrimitive.Separator
>;
export type ContextMenuShortcutProps = ComponentProps<"span">;
export type ContextMenuSubProps = ComponentProps<
  typeof ContextMenuPrimitive.Sub
>;
export type ContextMenuSubTriggerProps = ComponentProps<
  typeof ContextMenuPrimitive.SubTrigger
>;
export type ContextMenuSubContentProps = ComponentProps<
  typeof ContextMenuPrimitive.SubContent
>;
export function ContextMenu(props: ContextMenuProps) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}
export function ContextMenuGroup(props: ContextMenuGroupProps) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
}
export function ContextMenuRadioGroup(props: ContextMenuRadioGroupProps) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
}
export function ContextMenuSub(props: ContextMenuSubProps) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

export function ContextMenuTrigger({
  className,
  ...props
}: ContextMenuTriggerProps) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

export function ContextMenuContent({
  className,
  children,
  ...props
}: ContextMenuContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        data-motion-item
        className={cn(
          menuContentLayoutClasses,
          "max-h-(--radix-context-menu-content-available-height) max-w-(--radix-context-menu-content-available-width)",
          "origin-(--radix-context-menu-content-transform-origin)",
          menuContentSurfaceClasses,
          className,
        )}
        {...props}
        data-kit="context-menu"
      >
        <ScrollArea className="max-h-[inherit] rounded-[inherit] p-1">
          {children}
        </ScrollArea>
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuSubContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: ContextMenuSubContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-slot="context-menu-sub-content"
        data-motion-item
        sideOffset={sideOffset}
        className={cn(
          menuContentLayoutClasses,
          "max-h-(--radix-context-menu-content-available-height) max-w-(--radix-context-menu-content-available-width)",
          "origin-(--radix-context-menu-content-transform-origin)",
          menuContentSurfaceClasses,
          className,
        )}
        {...props}
        data-kit="context-menu"
      >
        <ScrollArea className="max-h-[inherit] rounded-[inherit] p-1">
          {children}
        </ScrollArea>
      </ContextMenuPrimitive.SubContent>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({ className, ...props }: ContextMenuItemProps) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(menuItemClasses, menuForcedColorsClasses, className)}
      {...props}
    />
  );
}
export function ContextMenuLabel({
  className,
  ...props
}: ContextMenuLabelProps) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      className={cn(menuLabelClasses, className)}
      {...props}
    />
  );
}
export function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuSeparatorProps) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn(menuSeparatorClasses, className)}
      {...props}
    />
  );
}
export function ContextMenuShortcut({
  className,
  ...props
}: ContextMenuShortcutProps) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(menuShortcutClasses, className)}
      {...props}
    />
  );
}
export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: ContextMenuSubTriggerProps) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(
        menuItemClasses,
        menuForcedColorsClasses,
        "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" aria-hidden="true" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuRadioItem({
  className,
  children,
  ...props
}: ContextMenuRadioItemProps) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        menuItemClasses,
        menuForcedColorsClasses,
        "pl-8",
        className,
      )}
      {...props}
    >
      <span
        data-slot="context-menu-item-indicator"
        className={menuIndicatorClasses}
      >
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="size-2! fill-current" aria-hidden="true" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: ContextMenuCheckboxItemProps) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(
        menuItemClasses,
        menuForcedColorsClasses,
        "pl-8",
        className,
      )}
      {...props}
    >
      <span
        data-slot="context-menu-item-indicator"
        className={menuIndicatorClasses}
      >
        <ContextMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}
