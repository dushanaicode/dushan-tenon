import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, Loading, VirtualLog } from "@/kit";
import { filesFileTextPage } from "@/lib/generated/commands";
import type { FileSummary } from "@/lib/generated/FileSummary";
import type { FileTextPage } from "@/lib/generated/FileTextPage";
import type { IpcError } from "@/lib/generated/IpcError";

export function TextPreview({
  file,
  userId,
}: {
  file: FileSummary;
  userId: string;
}) {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState<{
    offset: number;
    fingerprint: string | null;
  }>({ offset: 0, fingerprint: null });
  const [previous, setPrevious] = useState<number[]>([]);
  const page = useQuery<FileTextPage, IpcError>({
    queryKey: [
      "files",
      userId,
      "text-page",
      file.id,
      cursor.offset,
      cursor.fingerprint,
    ],
    queryFn: async ({ signal }) => {
      const result = await filesFileTextPage({ id: file.id, ...cursor });
      signal.throwIfAborted();
      return result;
    },
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const lines = useMemo(
    () => page.data?.text.split(/\r?\n/) ?? [],
    [page.data?.text],
  );
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("files.textPage.description")}
      </p>
      {page.isPending ? (
        <Loading label={t("files.loading")} />
      ) : page.isError ? (
        <IpcErrorMessage error={page.error} />
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {t("files.textPage.range", {
              start: page.data.totalBytes === 0 ? 0 : page.data.offset + 1,
              end: page.data.nextOffset ?? page.data.totalBytes,
              total: page.data.totalBytes,
            })}
          </p>
          <VirtualLog
            region="content"
            key={`${file.id}:${page.data.offset}`}
            label={file.originalName}
            lines={lines}
            height="min(45vh, 360px)"
          />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={page.isFetching}
          onClick={() => {
            setPrevious([]);
            if (cursor.offset === 0 && cursor.fingerprint === null)
              void page.refetch();
            else setCursor({ offset: 0, fingerprint: null });
          }}
        >
          {t("files.textPage.first")}
        </Button>
        <Button
          variant="outline"
          disabled={page.isFetching || previous.length === 0}
          onClick={() => {
            const offset = previous[previous.length - 1];
            setPrevious(previous.slice(0, -1));
            setCursor({ offset, fingerprint: cursor.fingerprint });
          }}
        >
          {t("files.textPage.previous")}
        </Button>
        <Button
          variant="outline"
          disabled={
            page.isFetching ||
            page.isError ||
            !page.data ||
            page.data.nextOffset === null
          }
          onClick={() => {
            const data = page.data;
            if (!data || data.nextOffset === null) return;
            setPrevious([...previous, data.offset]);
            setCursor({
              offset: data.nextOffset,
              fingerprint: data.fingerprint,
            });
          }}
        >
          {t("files.textPage.next")}
        </Button>
      </div>
    </div>
  );
}
