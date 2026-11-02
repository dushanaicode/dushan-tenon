// Adapted from shadcn/ui's MIT-licensed new-york-v4 Dialog (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";

export type DialogProps = ComponentProps<typeof DialogPrimitive.Root>;
export type DialogTriggerProps = ComponentProps<typeof DialogPrimitive.Trigger>;
export type DialogCloseProps = ComponentProps<typeof DialogPrimitive.Close>;
export type DialogContentProps = ComponentProps<
  typeof DialogPrimitive.Content
> & {
  showCloseButton?: boolean;
  closeLabel?: string;
};
export type DialogHeaderProps = ComponentProps<"div">;
export type DialogFooterProps = ComponentProps<"div"> & {
  showCloseButton?: boolean;
  closeLabel?: string;
};
export type DialogTitleProps = ComponentProps<typeof DialogPrimitive.Title>;
export type DialogDescriptionProps = ComponentProps<
  typeof DialogPrimitive.Description
>;

export function Dialog({ ...props }: DialogProps) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger({ ...props }: DialogTriggerProps) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogClose({ ...props }: DialogCloseProps) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

// DialogContent 必须包含 DialogTitle，为对话框提供可访问名称。
export function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  ...props
}: DialogContentProps) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        data-motion-item
        className="kit-overlay fixed inset-0 z-50 bg-scrim"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-motion-item
        className={cn(
          "kit-pop kit-edge-stack fixed top-1/2 left-1/2 z-50 grid w-full",
          "max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
          "gap-stack rounded-lg border border-border bg-card p-panel",
          "text-card-foreground shadow-popover sm:max-w-lg",
          "focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
        data-kit="dialog"
      >
        {children}
        {showCloseButton && (
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              aria-label={closeLabel ?? t("kit.close")}
            >
              <Icon iconId="close" />
            </Button>
          </DialogClose>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-stack text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  showCloseButton = false,
  closeLabel,
  children,
  ...props
}: DialogFooterProps) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-stack sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose asChild>
          <Button variant="outline">{closeLabel ?? t("kit.close")}</Button>
        </DialogClose>
      )}
    </div>
  );
}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-body text-muted-foreground", className)}
      {...props}
    />
  );
}
