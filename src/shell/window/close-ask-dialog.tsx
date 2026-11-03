import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@/kit";
import type { CloseChoice } from "@/lib/generated/CloseChoice";
import type { IpcError } from "@/lib/generated/IpcError";
import type { WindowCloseDecision } from "@/lib/generated/WindowCloseDecision";
import { cn } from "@/lib/utils";

export interface CloseAskDialogProps {
  trayAvailable: boolean;
  pending: boolean;
  error: IpcError | null;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  onConfirm: (decision: WindowCloseDecision) => void;
}

// 仅在询问打开时挂载，每次询问都有独立的选择与记住状态。
export function CloseAskDialog({
  trayAvailable,
  pending,
  error,
  returnFocus,
  onCancel,
  onConfirm,
}: CloseAskDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<CloseChoice>(
    trayAvailable ? "tray" : "exit",
  );
  const [remember, setRemember] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gap-5 p-7"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {t("shell.window.ask.title")}
          </DialogTitle>
          <DialogDescription>
            {t("shell.window.ask.description")}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          aria-label={t("shell.window.ask.title")}
          value={action}
          onValueChange={(value) => setAction(value as CloseChoice)}
          disabled={pending}
          className="gap-3"
        >
          {(["tray", "exit"] as const).map((choice) => (
            <Label
              key={choice}
              htmlFor={`${id}-${choice}`}
              className={cn(
                "flex items-start gap-3 rounded-lg border border-input p-4 text-body",
                action === choice && "border-ring bg-foreground/5",
                (pending || (choice === "tray" && !trayAvailable)) &&
                  "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem
                id={`${id}-${choice}`}
                value={choice}
                disabled={pending || (choice === "tray" && !trayAvailable)}
                aria-labelledby={`${id}-${choice}-label`}
                aria-describedby={`${id}-${choice}-description`}
                className="mt-0.5"
              />
              <span className="grid gap-1">
                <span id={`${id}-${choice}-label`} className="font-semibold">
                  {t(`shell.window.ask.${choice}`)}
                </span>
                <span
                  id={`${id}-${choice}-description`}
                  className="font-normal text-muted-foreground"
                >
                  {t(
                    choice === "tray" && !trayAvailable
                      ? "shell.window.ask.trayUnavailable"
                      : `shell.window.ask.${choice}Description`,
                  )}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-remember`}
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
              disabled={pending}
              aria-describedby={`${id}-remember-description`}
            />
            <Label htmlFor={`${id}-remember`}>
              {t("shell.window.ask.remember")}
            </Label>
          </div>
          <p
            id={`${id}-remember-description`}
            className="text-body text-muted-foreground"
          >
            {t("shell.window.ask.rememberDescription")}
          </p>
        </div>
        {error &&
          (error.code === "app.settings.overridden" ? (
            <p role="alert" className="text-body text-destructive">
              {t("shell.window.ask.overridden")}
            </p>
          ) : (
            <IpcErrorMessage error={error} />
          ))}
        <DialogFooter>
          <Button
            ref={cancel}
            variant="outline"
            disabled={pending}
            onClick={onCancel}
          >
            {t("shell.window.ask.cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={() => onConfirm({ action, remember })}
          >
            {t("shell.window.ask.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
