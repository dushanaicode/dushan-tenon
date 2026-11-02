// Adapted from shadcn/ui's MIT-licensed new-york-v4 AlertDialog (shadcn-ui/ui d2fba50); semantic kit tokens.
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Spinner } from "./spinner";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
};

// 调用方处理操作结果；仅在成功后把 open 设为 false。
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const previousFocus = useRef<Element | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = pending || submitting;
  return (
    <AlertDialogPrimitive.Root
      data-slot="alert-dialog"
      open={open}
      onOpenChange={(next) => {
        if (!pending && !inFlight.current) onOpenChange(next);
      }}
    >
      <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal">
        <AlertDialogPrimitive.Overlay
          data-slot="alert-dialog-overlay"
          data-motion-item
          className="kit-overlay fixed inset-0 z-50 bg-scrim"
        />
        <AlertDialogPrimitive.Content
          ref={contentRef}
          data-slot="alert-dialog-content"
          data-kit="alert-dialog"
          data-motion-item
          aria-describedby={description == null ? undefined : descriptionId}
          className={cn(
            "kit-pop fixed top-1/2 left-1/2 z-50 grid w-full",
            "max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
            "gap-stack rounded-lg border border-border bg-card p-panel",
            "text-card-foreground shadow-popover sm:max-w-lg",
            "focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
          onOpenAutoFocus={(event) => {
            previousFocus.current = document.activeElement;
            if (busy) {
              event.preventDefault();
              contentRef.current?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            // 此受控封装没有 Radix Trigger，返回打开前的焦点。
            event.preventDefault();
            if (previousFocus.current instanceof HTMLElement) {
              previousFocus.current.focus();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (pending || inFlight.current) event.preventDefault();
          }}
          onKeyDownCapture={(event) => {
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing ||
                event.keyCode === 229 ||
                event.repeat)
            ) {
              event.preventDefault();
            }
          }}
          // AlertDialog 内置 onPointerDownOutside.preventDefault()，
          // 且不向调用方开放该属性；外部点击始终不能关闭。
        >
          <div
            data-slot="alert-dialog-header"
            className="flex flex-col gap-stack"
          >
            <AlertDialogPrimitive.Title
              data-slot="alert-dialog-title"
              className="text-lg font-semibold"
            >
              {title}
            </AlertDialogPrimitive.Title>
            {description != null && (
              <AlertDialogPrimitive.Description
                id={descriptionId}
                data-slot="alert-dialog-description"
                className="text-body text-muted-foreground"
              >
                {description}
              </AlertDialogPrimitive.Description>
            )}
          </div>
          <div
            data-slot="alert-dialog-footer"
            className={cn(
              "flex flex-col-reverse gap-stack",
              "sm:flex-row sm:justify-end",
            )}
          >
            <AlertDialogPrimitive.Cancel
              data-slot="alert-dialog-cancel"
              asChild
            >
              <Button variant="outline" disabled={busy}>
                {cancelLabel ?? t("kit.cancel")}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              data-slot="alert-dialog-action"
              asChild
            >
              <Button
                variant={tone}
                disabled={busy}
                aria-busy={busy}
                onClick={async (event) => {
                  event.preventDefault();
                  if (pending || inFlight.current) return;
                  inFlight.current = true;
                  try {
                    const result = onConfirm();
                    if (result) {
                      setSubmitting(true);
                      await result;
                    }
                  } finally {
                    inFlight.current = false;
                    setSubmitting(false);
                  }
                }}
              >
                {busy && <Spinner aria-hidden="true" />}
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
