// Adapted from shadcn/ui's MIT-licensed new-york-v4 DropdownMenu
// (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Check, ChevronRight, Circle } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
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

export type DropdownMenuProps = ComponentProps<
  typeof DropdownMenuPrimitive.Root
>;
export type DropdownMenuTriggerProps = ComponentProps<
  typeof DropdownMenuPrimitive.Trigger
>;
export type DropdownMenuContentProps = ComponentProps<
  typeof DropdownMenuPrimitive.Content
>;
export type DropdownMenuGroupProps = ComponentProps<
  typeof DropdownMenuPrimitive.Group
>;
export type DropdownMenuItemProps = ComponentProps<
  typeof DropdownMenuPrimitive.Item
>;
export type DropdownMenuLabelProps = ComponentProps<
  typeof DropdownMenuPrimitive.Label
>;
export type DropdownMenuSeparatorProps = ComponentProps<
  typeof DropdownMenuPrimitive.Separator
>;
export type DropdownMenuRadioGroupProps = ComponentProps<
  typeof DropdownMenuPrimitive.RadioGroup
>;
export type DropdownMenuRadioItemProps = ComponentProps<
  typeof DropdownMenuPrimitive.RadioItem
>;

export type DropdownMenuCheckboxItemProps = ComponentProps<
  typeof DropdownMenuPrimitive.CheckboxItem
>;
export type DropdownMenuSubProps = ComponentProps<
  typeof DropdownMenuPrimitive.Sub
>;
export type DropdownMenuSubTriggerProps = ComponentProps<
  typeof DropdownMenuPrimitive.SubTrigger
>;
export type DropdownMenuSubContentProps = ComponentProps<
  typeof DropdownMenuPrimitive.SubContent
>;
export type DropdownMenuShortcutProps = ComponentProps<"span">;

export function DropdownMenu(props: DropdownMenuProps) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  );
}

export function DropdownMenuContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        data-motion-item
        sideOffset={sideOffset}
        className={cn(
          menuContentLayoutClasses,
          "max-h-(--radix-dropdown-menu-content-available-height)",
          "origin-(--radix-dropdown-menu-content-transform-origin)",
          menuContentSurfaceClasses,
          className,
        )}
        {...props}
      >
        <ScrollArea className="max-h-[inherit] rounded-[inherit] p-1">
          {children}
        </ScrollArea>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuGroup(props: DropdownMenuGroupProps) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(menuItemClasses, className)}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: DropdownMenuLabelProps) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(menuLabelClasses, className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: DropdownMenuSeparatorProps) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn(menuSeparatorClasses, className)}
      {...props}
    />
  );
}

export function DropdownMenuRadioGroup(props: DropdownMenuRadioGroupProps) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(menuItemClasses, "pl-8", className)}
      {...props}
    >
      <span
        data-slot="dropdown-menu-item-indicator"
        className={menuIndicatorClasses}
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="size-2! fill-current" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        menuItemClasses,
        menuForcedColorsClasses,
        "pl-8",
        className,
      )}
      {...props}
    >
      <span
        data-slot="dropdown-menu-item-indicator"
        className={menuIndicatorClasses}
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuSub(props: DropdownMenuSubProps) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
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
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        data-motion-item
        sideOffset={sideOffset}
        className={cn(
          menuContentLayoutClasses,
          "max-h-(--radix-dropdown-menu-content-available-height) max-w-(--radix-dropdown-menu-content-available-width)",
          "origin-(--radix-dropdown-menu-content-transform-origin)",
          menuContentSurfaceClasses,
          className,
        )}
        {...props}
      >
        <ScrollArea className="max-h-[inherit] rounded-[inherit] p-1">
          {children}
        </ScrollArea>
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: DropdownMenuShortcutProps) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(menuShortcutClasses, className)}
      {...props}
    />
  );
}
