// Adapted from shadcn/ui's MIT-licensed new-york-v4 Sheet (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";

export type SheetProps = ComponentProps<typeof DialogPrimitive.Root>;
export type SheetTriggerProps = ComponentProps<typeof DialogPrimitive.Trigger>;
export type SheetCloseProps = ComponentProps<typeof DialogPrimitive.Close>;
export type SheetContentProps = ComponentProps<
  typeof DialogPrimitive.Content
> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
  closeLabel?: string;
};
export type SheetHeaderProps = ComponentProps<"div">;
export type SheetFooterProps = ComponentProps<"div">;
export type SheetTitleProps = ComponentProps<typeof DialogPrimitive.Title>;
export type SheetDescriptionProps = ComponentProps<
  typeof DialogPrimitive.Description
>;

export function Sheet({ ...props }: SheetProps) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger({ ...props }: SheetTriggerProps) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose({ ...props }: SheetCloseProps) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

// SheetContent 必须包含 SheetTitle，为面板提供可访问名称。
export function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  closeLabel,
  ...props
}: SheetContentProps) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        data-motion-item
        className="kit-overlay fixed inset-0 z-50 bg-scrim"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-motion-item
        className={cn(
          "kit-slide fixed z-50 flex flex-col gap-stack bg-card p-panel",
          "text-card-foreground shadow-popover",
          "focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          side === "right" &&
            "inset-y-0 right-0 h-full w-full border-l sm:max-w-md",
          side === "left" &&
            "inset-y-0 left-0 h-full w-full border-r sm:max-w-md",
          side === "top" && "inset-x-0 top-0 h-auto w-full border-b",
          side === "bottom" && "inset-x-0 bottom-0 h-auto w-full border-t",
          "border-border",
          className,
        )}
        {...props}
        data-kit="sheet"
      >
        {children}
        {showCloseButton && (
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              aria-label={closeLabel ?? t("kit.close")}
            >
              <Icon iconId="close" />
            </Button>
          </SheetClose>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: SheetHeaderProps) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-stack", className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: SheetFooterProps) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-stack", className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: SheetTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: SheetDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-body text-muted-foreground", className)}
      {...props}
    />
  );
}
