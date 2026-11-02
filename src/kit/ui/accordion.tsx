// 套件自写；许可见项目根 LICENSE。
import { ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type AccordionProps = ComponentProps<typeof AccordionPrimitive.Root>;
export type AccordionItemProps = ComponentProps<typeof AccordionPrimitive.Item>;
export type AccordionTriggerProps = ComponentProps<
  typeof AccordionPrimitive.Trigger
> & { headingLevel?: 2 | 3 | 4 | 5 | 6 };
export type AccordionContentProps = ComponentProps<
  typeof AccordionPrimitive.Content
>;

export function Accordion({ className, ...props }: AccordionProps) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("min-w-0", className)}
      {...props}
      data-kit="accordion"
    />
  );
}
export function AccordionItem({ className, ...props }: AccordionItemProps) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-border", className)}
      {...props}
    />
  );
}
export function AccordionTrigger({
  className,
  children,
  headingLevel = 3,
  ...props
}: AccordionTriggerProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <AccordionPrimitive.Header asChild>
      <Heading data-slot="accordion-header" className="flex min-w-0">
        <AccordionPrimitive.Trigger
          data-slot="accordion-trigger"
          data-motion-item
          className={cn(
            "group relative flex min-h-control min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 text-left text-body font-medium break-words",
            "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50 kit-icon-control",
            "forced-colors:data-[state=open]:bg-[Highlight]! forced-colors:data-[state=open]:text-[HighlightText]!",
            "forced-colors:data-[state=open]:[forced-color-adjust:preserve-parent-color]",
            "forced-colors:hover:bg-[Highlight]! forced-colors:hover:text-[HighlightText]! forced-colors:hover:[forced-color-adjust:preserve-parent-color]",
            className,
          )}
          {...props}
        >
          <span className="min-w-0 flex-1">{children}</span>
          <ChevronDown
            data-slot="accordion-chevron"
            data-motion-item
            aria-hidden="true"
            className="shrink-0 motion-transform group-data-[state=open]:rotate-180"
          />
        </AccordionPrimitive.Trigger>
      </Heading>
    </AccordionPrimitive.Header>
  );
}
export function AccordionContent({
  className,
  children,
  ...props
}: AccordionContentProps) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      data-motion-item
      className={cn(
        "kit-collapse overflow-hidden text-body break-words",
        "[--kit-content-height:var(--radix-accordion-content-height)]",
        className,
      )}
      {...props}
    >
      <div className="px-2 pb-3">{children}</div>
    </AccordionPrimitive.Content>
  );
}
