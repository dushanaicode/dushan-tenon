// Adapted from shadcn/ui (MIT):
// apps/v4/registry/new-york-v4/ui/card.tsx
// Source: shadcn-ui/ui d2fba50ee5b9113008b5bb908563527b7efd2f27.
// Semantic kit tokens and density. License: ./LICENSE.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type CardProps = ComponentProps<"div">;
export type CardHeaderProps = ComponentProps<"div">;
export type CardTitleProps = ComponentProps<"div">;
export type CardDescriptionProps = ComponentProps<"div">;
export type CardActionProps = ComponentProps<"div">;
export type CardContentProps = ComponentProps<"div">;
export type CardFooterProps = ComponentProps<"div">;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        "kit-edge-stack flex flex-col gap-stack rounded-xl border border-border",
        "bg-card py-panel text-card-foreground shadow-card",
        className,
      )}
      {...props}
      data-kit="card"
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto]",
        "items-start gap-2 px-panel",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: CardTitleProps) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-body font-semibold", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardAction({ className, ...props }: CardActionProps) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: CardContentProps) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-panel", className)}
      {...props}
    />
  );
}

export function CardFooter({ className, ...props }: CardFooterProps) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-panel gap-2", className)}
      {...props}
    />
  );
}
