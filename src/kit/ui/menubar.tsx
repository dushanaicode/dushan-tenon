// 套件自写；许可见项目根 LICENSE。
import { Check, ChevronRight, Circle } from "lucide-react";
import { Menubar as MenubarPrimitive } from "radix-ui";
import { type ComponentProps, createContext, useContext, useId } from "react";
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

export type MenubarProps = ComponentProps<typeof MenubarPrimitive.Root>;
export type MenubarMenuProps = ComponentProps<typeof MenubarPrimitive.Menu>;
export type MenubarTriggerProps = ComponentProps<
  typeof MenubarPrimitive.Trigger
>;
export type MenubarContentProps = ComponentProps<
  typeof MenubarPrimitive.Content
>;
export type MenubarGroupProps = ComponentProps<typeof MenubarPrimitive.Group>;
export type MenubarItemProps = ComponentProps<typeof MenubarPrimitive.Item>;
export type MenubarCheckboxItemProps = ComponentProps<
  typeof MenubarPrimitive.CheckboxItem
>;
export type MenubarRadioGroupProps = ComponentProps<
  typeof MenubarPrimitive.RadioGroup
>;
export type MenubarRadioItemProps = ComponentProps<
  typeof MenubarPrimitive.RadioItem
>;
export type MenubarLabelProps = ComponentProps<typeof MenubarPrimitive.Label>;
export type MenubarSeparatorProps = ComponentProps<
  typeof MenubarPrimitive.Separator
>;
export type MenubarShortcutProps = ComponentProps<"span">;
export type MenubarSubProps = ComponentProps<typeof MenubarPrimitive.Sub>;
export type MenubarSubTriggerProps = ComponentProps<
  typeof MenubarPrimitive.SubTrigger
>;
export type MenubarSubContentProps = ComponentProps<
  typeof MenubarPrimitive.SubContent
>;

const MenubarInstance = createContext<string | undefined>(undefined);

/** WebView 内菜单栏，不注册系统原生菜单。 */
export function Menubar({ className, ...props }: MenubarProps) {
  const instance = useId();
  return (
    <MenubarInstance value={instance}>
      <MenubarPrimitive.Root
        data-slot="menubar"
        className={cn(
          "flex min-w-0 items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground",
          className,
        )}
        {...props}
        data-kit="menubar"
      />
    </MenubarInstance>
  );
}
export function MenubarMenu(props: MenubarMenuProps) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}
export function MenubarGroup(props: MenubarGroupProps) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />;
}
export function MenubarRadioGroup(props: MenubarRadioGroupProps) {
  return (
    <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />
  );
}
export function MenubarSub(props: MenubarSubProps) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

export function MenubarTrigger({ className, ...props }: MenubarTriggerProps) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        menuItemClasses,
        menuForcedColorsClasses,
        "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MenubarContent({
  className,
  children,
  sideOffset = 4,
  onFocusOutside,
  ...props
}: MenubarContentProps) {
  const instance = useContext(MenubarInstance);
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        data-motion-item
        sideOffset={sideOffset}
        className={cn(
          menuContentLayoutClasses,
          "max-h-(--radix-menubar-content-available-height) max-w-(--radix-menubar-content-available-width)",
          "origin-(--radix-menubar-content-transform-origin)",
          menuContentSurfaceClasses,
          className,
        )}
        {...props}
        data-kit="menubar"
        data-menubar-instance={instance}
        onFocusOutside={(event) => {
          onFocusOutside?.(event);
          if (event.defaultPrevented) return;
          // 旧菜单退出动画期间，新菜单取得焦点仍属于本菜单栏。
          const sibling = (event.target as HTMLElement).closest(
            "[data-menubar-instance]",
          );
          if (sibling?.getAttribute("data-menubar-instance") === instance)
            event.preventDefault();
        }}
      >
        <ScrollArea className="max-h-[inherit] rounded-[inherit] p-1">
          {children}
        </ScrollArea>
      </MenubarPrimitive.Content>
    </MenubarPrimitive.Portal>
  );
}

export function MenubarSubContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: MenubarSubContentProps) {
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.SubContent
        data-slot="menubar-sub-content"
        data-motion-item
        sideOffset={sideOffset}
        className={cn(
          menuContentLayoutClasses,
          "max-h-(--radix-menubar-content-available-height) max-w-(--radix-menubar-content-available-width)",
          "origin-(--radix-menubar-content-transform-origin)",
          menuContentSurfaceClasses,
          className,
        )}
        {...props}
        data-kit="menubar"
      >
        <ScrollArea className="max-h-[inherit] rounded-[inherit] p-1">
          {children}
        </ScrollArea>
      </MenubarPrimitive.SubContent>
    </MenubarPrimitive.Portal>
  );
}

export function MenubarItem({ className, ...props }: MenubarItemProps) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      className={cn(menuItemClasses, menuForcedColorsClasses, className)}
      {...props}
    />
  );
}
export function MenubarLabel({ className, ...props }: MenubarLabelProps) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      className={cn(menuLabelClasses, className)}
      {...props}
    />
  );
}
export function MenubarSeparator({
  className,
  ...props
}: MenubarSeparatorProps) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn(menuSeparatorClasses, className)}
      {...props}
    />
  );
}
export function MenubarShortcut({ className, ...props }: MenubarShortcutProps) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(menuShortcutClasses, className)}
      {...props}
    />
  );
}
export function MenubarSubTrigger({
  className,
  children,
  ...props
}: MenubarSubTriggerProps) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
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
    </MenubarPrimitive.SubTrigger>
  );
}

export function MenubarRadioItem({
  className,
  children,
  ...props
}: MenubarRadioItemProps) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn(
        menuItemClasses,
        menuForcedColorsClasses,
        "pl-8",
        className,
      )}
      {...props}
    >
      <span data-slot="menubar-item-indicator" className={menuIndicatorClasses}>
        <MenubarPrimitive.ItemIndicator>
          <Circle className="size-2! fill-current" aria-hidden="true" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  );
}

export function MenubarCheckboxItem({
  className,
  children,
  ...props
}: MenubarCheckboxItemProps) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      className={cn(
        menuItemClasses,
        menuForcedColorsClasses,
        "pl-8",
        className,
      )}
      {...props}
    >
      <span data-slot="menubar-item-indicator" className={menuIndicatorClasses}>
        <MenubarPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  );
}
