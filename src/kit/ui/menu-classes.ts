// 套件自写；许可见项目根 LICENSE。
import { cn } from "@/lib/utils";

export const menuItemClasses = cn(
  "relative flex min-h-control cursor-default items-center gap-2",
  "rounded-sm px-2 py-1.5 text-body select-none",
  "data-[highlighted]:bg-accent",
  "data-[highlighted]:text-accent-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  "kit-icon-control [&_svg]:pointer-events-none [&_svg]:shrink-0",
);
export const menuContentLayoutClasses = "kit-pop z-50 min-w-32";
export const menuContentSurfaceClasses = cn(
  "rounded-lg border border-border bg-popover",
  "text-popover-foreground shadow-popover",
  "focus-visible:outline-none",
);
export const menuLabelClasses = "px-2 py-1.5 text-body font-medium";
export const menuSeparatorClasses = "-mx-1 my-1 h-px bg-border";
export const menuIndicatorClasses = cn(
  "pointer-events-none absolute left-2 flex size-4",
  "items-center justify-center",
);
export const menuShortcutClasses =
  "ml-auto shrink-0 text-xs text-muted-foreground forced-colors:text-[inherit]!";

// 系统色显式配对；preserve-parent-color 避免 Chromium 的黑色文字背板。
export const menuForcedColorsClasses = cn(
  "forced-colors:data-[highlighted]:bg-[Highlight]! forced-colors:data-[highlighted]:text-[HighlightText]!",
  "forced-colors:data-[highlighted]:[forced-color-adjust:preserve-parent-color]",
  "forced-colors:data-[state=open]:bg-[Highlight]! forced-colors:data-[state=open]:text-[HighlightText]!",
  "forced-colors:data-[state=open]:[forced-color-adjust:preserve-parent-color]",
);
