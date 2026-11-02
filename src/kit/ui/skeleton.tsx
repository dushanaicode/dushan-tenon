// Adapted from shadcn/ui's MIT-licensed new-york-v4 Skeleton (shadcn-ui/ui d2fba50); semantic kit tokens.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type SkeletonProps = ComponentProps<"div">;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      data-motion-item
      className={cn("kit-pulse rounded-md bg-muted", className)}
      {...props}
      aria-hidden="true"
    />
  );
}
