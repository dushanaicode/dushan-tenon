// Adapted from shadcn/ui's MIT-licensed new-york-v4 Avatar
// (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Avatar as AvatarPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type AvatarProps = ComponentProps<typeof AvatarPrimitive.Root>;
export type AvatarFallbackProps = ComponentProps<
  typeof AvatarPrimitive.Fallback
>;

export function Avatar({ className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        "bg-muted text-muted-foreground select-none",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarFallback({ className, ...props }: AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full text-body",
        className,
      )}
      {...props}
    />
  );
}
