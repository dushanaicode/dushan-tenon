import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from "@/kit";
import { filesFilePreview } from "@/lib/generated/commands";
import type { FilePreview } from "@/lib/generated/FilePreview";
import type { FileSummary } from "@/lib/generated/FileSummary";
import type { IpcError } from "@/lib/generated/IpcError";
import { TextPreview } from "./text-preview";

export function FileDialog({
  title,
  close,
  children,
  actions,
  busy,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  actions: ReactNode;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const previousFocus = useRef<Element | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl"
        onOpenAutoFocus={(event) => {
          previousFocus.current = document.activeElement;
          event.preventDefault();
          closeButton.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previousFocus.current instanceof HTMLElement) {
            previousFocus.current.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 px-panel pt-(--panel-pad)">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ScrollArea
          region="content"
          className="min-h-0 flex-1"
          plateClassName="flex flex-col gap-stack px-panel py-(--stack-gap)"
        >
          {children}
        </ScrollArea>
        <DialogFooter className="shrink-0 px-panel pb-(--panel-pad)">
          {actions}
          <Button
            ref={closeButton}
            variant="ghost"
            disabled={busy}
            onClick={close}
          >
            {t("files.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Preview({
  file,
  userId,
}: {
  file: FileSummary;
  userId: string;
}) {
  return ["txt", "md", "csv", "json"].includes(file.extension) ? (
    <TextPreview key={file.id} file={file} userId={userId} />
  ) : (
    <SummaryPreview file={file} userId={userId} />
  );
}

function SummaryPreview({
  file,
  userId,
}: {
  file: FileSummary;
  userId: string;
}) {
  const { t } = useTranslation();
  const supported = !["pdf", "xlsx"].includes(file.extension);
  const preview = useQuery<FilePreview, IpcError>({
    queryKey: ["files", userId, "preview", file.id],
    queryFn: async ({ signal }) => {
      const result = await filesFilePreview({ id: file.id });
      signal.throwIfAborted();
      return result;
    },
    gcTime: 0,
    enabled: supported,
  });
  if (!supported) return <p>{t("files.previewUnsupported")}</p>;
  if (preview.isPending) return <p role="status">{t("files.loading")}</p>;
  if (preview.isError) return <IpcErrorMessage error={preview.error} />;
  return preview.data.type === "image" ? (
    <img
      src={preview.data.dataUrl}
      alt={file.originalName}
      className="mx-auto max-h-[60vh] max-w-full object-contain"
    />
  ) : (
    <>
      {preview.data.truncated && <p role="status">{t("files.truncated")}</p>}
      <ScrollArea axis="both" className="max-h-[60vh] rounded-md bg-muted p-4">
        <pre className="whitespace-pre-wrap break-words text-sm">
          {preview.data.text}
        </pre>
      </ScrollArea>
    </>
  );
}
