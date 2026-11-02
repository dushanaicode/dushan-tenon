// Adapted from shadcn/ui (MIT):
// apps/v4/registry/new-york-v4/ui/kbd.tsx
// Source: shadcn-ui/ui d2fba50ee5b9113008b5bb908563527b7efd2f27.
// Semantic kit tokens and monospace keys. License: ./LICENSE.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type KbdProps = ComponentProps<"kbd">;
export type KbdGroupProps = ComponentProps<"kbd">;

export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center",
        "rounded-sm border border-border bg-muted px-1",
        "font-mono text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function KbdGroup({ className, ...props }: KbdGroupProps) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}
