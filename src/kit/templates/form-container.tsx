// 套件自写；许可见项目根 LICENSE。
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Spinner } from "../ui/spinner";

export type FormContainerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  submitLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  submitDisabled?: boolean;
  children: ReactNode;
};

function useFormInteraction({
  pending,
  submitDisabled,
  onSubmit,
  onOpenChange,
}: Pick<
  FormContainerProps,
  "pending" | "submitDisabled" | "onSubmit" | "onOpenChange"
>) {
  const inFlight = useRef(false);
  const previousFocus = useRef<Element | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = pending || submitting;
  return {
    busy,
    onOpenChange(next: boolean) {
      if (!pending && !inFlight.current) onOpenChange(next);
    },
    async onSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (pending || submitDisabled || inFlight.current) return;
      inFlight.current = true;
      try {
        const result = onSubmit(event);
        if (result) {
          setSubmitting(true);
          await result;
        }
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    contentProps: {
      showCloseButton: !busy,
      onOpenAutoFocus() {
        previousFocus.current = document.activeElement;
      },
      onCloseAutoFocus(event: Event) {
        event.preventDefault();
        if (previousFocus.current instanceof HTMLElement) {
          previousFocus.current.focus();
        }
      },
      onEscapeKeyDown(event: globalThis.KeyboardEvent) {
        if (pending || inFlight.current) event.preventDefault();
      },
      onInteractOutside(event: Event) {
        if (pending || inFlight.current) event.preventDefault();
      },
      onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
        if (
          event.key === "Enter" &&
          (event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            event.repeat)
        ) {
          event.preventDefault();
        }
      },
    },
  };
}

export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitLabel,
  cancelLabel,
  pending,
  submitDisabled,
  children,
}: FormContainerProps) {
  const { t } = useTranslation();
  const formId = useId();
  const descriptionId = useId();
  const interaction = useFormInteraction({
    pending,
    submitDisabled,
    onSubmit,
    onOpenChange,
  });
  return (
    <Sheet open={open} onOpenChange={interaction.onOpenChange}>
      <SheetContent
        {...interaction.contentProps}
        data-slot="form-sheet"
        side="right"
        aria-describedby={description == null ? undefined : descriptionId}
        className="gap-0 p-0"
      >
        <SheetHeader className="shrink-0 px-panel py-panel">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          {description != null && (
            <SheetDescription id={descriptionId}>
              {description}
            </SheetDescription>
          )}
        </SheetHeader>
        <ScrollArea
          region="content"
          className="min-h-0 flex-1"
          plateClassName="px-panel py-panel"
        >
          <form
            id={formId}
            data-slot="form-container-body"
            onSubmit={interaction.onSubmit}
            className="flex flex-col gap-stack"
          >
            {children}
          </form>
        </ScrollArea>
        <SheetFooter
          className={cn(
            "shrink-0 flex-row justify-end gap-2",
            "border-t border-border bg-card px-panel py-panel",
          )}
        >
          <Button
            type="button"
            variant="outline"
            disabled={interaction.busy}
            onClick={() => interaction.onOpenChange(false)}
          >
            {cancelLabel ?? t("kit.cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={interaction.busy || submitDisabled}
            aria-busy={interaction.busy}
          >
            {interaction.busy && <Spinner aria-hidden="true" />}
            {submitLabel ?? t("kit.form.submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitLabel,
  cancelLabel,
  pending,
  submitDisabled,
  children,
}: FormContainerProps) {
  const { t } = useTranslation();
  const formId = useId();
  const descriptionId = useId();
  const interaction = useFormInteraction({
    pending,
    submitDisabled,
    onSubmit,
    onOpenChange,
  });
  return (
    <Dialog open={open} onOpenChange={interaction.onOpenChange}>
      <DialogContent
        {...interaction.contentProps}
        data-slot="form-dialog"
        aria-describedby={description == null ? undefined : descriptionId}
        className="flex h-[calc(100dvh-2rem)] flex-col gap-0 p-0"
      >
        <DialogHeader className="shrink-0 px-panel py-panel">
          <DialogTitle className="pr-8">{title}</DialogTitle>
          {description != null && (
            <DialogDescription id={descriptionId}>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <ScrollArea
          region="content"
          className="min-h-0 flex-1"
          plateClassName="px-panel py-panel"
        >
          <form
            id={formId}
            data-slot="form-container-body"
            onSubmit={interaction.onSubmit}
            className="flex flex-col gap-stack"
          >
            {children}
          </form>
        </ScrollArea>
        <DialogFooter
          className={cn(
            "shrink-0 border-t border-border bg-card",
            "px-panel py-panel",
          )}
        >
          <Button
            type="button"
            variant="outline"
            disabled={interaction.busy}
            onClick={() => interaction.onOpenChange(false)}
          >
            {cancelLabel ?? t("kit.cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={interaction.busy || submitDisabled}
            aria-busy={interaction.busy}
          >
            {interaction.busy && <Spinner aria-hidden="true" />}
            {submitLabel ?? t("kit.form.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
