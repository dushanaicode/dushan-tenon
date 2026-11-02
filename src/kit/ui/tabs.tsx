// Adapted from shadcn/ui's MIT-licensed new-york-v4 Tabs (shadcn-ui/ui d2fba50); semantic kit tokens.
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type TabsProps = ComponentProps<typeof TabsPrimitive.Root>;

export function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsProps) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-stack data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  [
    "group/list inline-flex h-control w-fit items-center justify-center",
    "rounded-md px-1 text-muted-foreground",
    "group-data-[orientation=vertical]/tabs:h-auto",
    "group-data-[orientation=vertical]/tabs:flex-col",
    "data-[variant=line]:rounded-none",
  ],
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type TabsListProps = ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>;

export function TabsList({
  className,
  variant = "default",
  ...props
}: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant, className }))}
      {...props}
    />
  );
}

export type TabsTriggerProps = ComponentProps<typeof TabsPrimitive.Trigger>;

export function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-motion-item
      className={cn(
        "relative inline-flex h-full min-h-control min-w-(--control-h) flex-1",
        "items-center justify-center gap-1.5 rounded-md",
        "border border-transparent",
        "px-2 text-body font-medium whitespace-nowrap text-muted-foreground",
        "hover:text-foreground data-[state=active]:text-foreground",
        "group-data-[orientation=vertical]/tabs:w-full",
        "group-data-[orientation=vertical]/tabs:justify-start",
        "focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "group-data-[variant=default]/list:data-[state=active]:bg-card",
        "group-data-[variant=default]/list:data-[state=active]:shadow-card",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        "[&_svg:not([class*='size-'])]:size-4",
        "after:absolute after:content-[''] after:bg-brand after:opacity-0",
        "after:motion-opacity",
        "group-data-[orientation=horizontal]/tabs:after:inset-x-0",
        "group-data-[orientation=horizontal]/tabs:after:bottom-0",
        "group-data-[orientation=horizontal]/tabs:after:h-0.5",
        "group-data-[orientation=vertical]/tabs:after:inset-y-0",
        "group-data-[orientation=vertical]/tabs:after:right-0",
        "group-data-[orientation=vertical]/tabs:after:w-0.5",
        "group-data-[variant=line]/list:data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export type TabsContentProps = ComponentProps<typeof TabsPrimitive.Content>;

export function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "flex-1 focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
