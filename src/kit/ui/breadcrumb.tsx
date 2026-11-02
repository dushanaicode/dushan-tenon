// 套件自写；许可见项目根 LICENSE。
import { ChevronRight, Ellipsis } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type BreadcrumbProps = ComponentProps<"nav"> & { "aria-label": string };
export type BreadcrumbListProps = ComponentProps<"ol">;
export type BreadcrumbItemProps = ComponentProps<"li">;
export type BreadcrumbLinkProps = ComponentProps<"a"> & { asChild?: boolean };
export type BreadcrumbPageProps = ComponentProps<"span">;
export type BreadcrumbSeparatorProps = ComponentProps<"li">;
export type BreadcrumbEllipsisProps = ComponentProps<"span">;

export function Breadcrumb({ className, ...props }: BreadcrumbProps) {
  return (
    <nav
      data-slot="breadcrumb"
      className={cn("min-w-0", className)}
      {...props}
      data-kit="breadcrumb"
    />
  );
}
export function BreadcrumbList({ className, ...props }: BreadcrumbListProps) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-body text-muted-foreground break-words",
        className,
      )}
      {...props}
    />
  );
}
export function BreadcrumbItem({ className, ...props }: BreadcrumbItemProps) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      {...props}
    />
  );
}
export function BreadcrumbLink({
  asChild,
  className,
  ...props
}: BreadcrumbLinkProps) {
  const Comp = asChild ? Slot.Root : "a";
  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn(
        "min-w-0 rounded-sm break-words hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
export function BreadcrumbPage({ className, ...props }: BreadcrumbPageProps) {
  return (
    <span
      data-slot="breadcrumb-page"
      className={cn("min-w-0 text-foreground break-words", className)}
      {...props}
      aria-current="page"
    />
  );
}
export function BreadcrumbSeparator({
  className,
  children,
  ...props
}: BreadcrumbSeparatorProps) {
  return (
    <li
      data-slot="breadcrumb-separator"
      className={cn("kit-icon-control shrink-0", className)}
      {...props}
      role="presentation"
      aria-hidden="true"
    >
      {children ?? <ChevronRight aria-hidden="true" />}
    </li>
  );
}
export function BreadcrumbEllipsis({
  className,
  children,
  ...props
}: BreadcrumbEllipsisProps) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      className={cn(
        "inline-flex items-center justify-center kit-icon-control",
        className,
      )}
      {...props}
    >
      <Ellipsis aria-hidden="true" />
      <span className="sr-only">{children}</span>
    </span>
  );
}
