import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ErrorView,
} from "@/kit";
import type { FileSummary } from "@/lib/generated/FileSummary";
import type { IpcError } from "@/lib/generated/IpcError";
import type { Page } from "@/lib/generated/Page";

export const pageSize = 20;
export function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function FileTable({
  files,
  page,
  filtered,
  pending,
  writable,
  onPage,
  onOpen,
  onSave,
}: {
  files: UseQueryResult<Page<FileSummary>, IpcError>;
  page: number;
  filtered: boolean;
  pending: boolean;
  writable: boolean;
  onPage: (page: number) => void;
  onOpen: (dialog: { kind: "preview" | "delete"; file: FileSummary }) => void;
  onSave: (file: FileSummary) => void;
}) {
  const { t, i18n } = useTranslation();
  const columns = useMemo<DataTableColumn<FileSummary>[]>(() => {
    const dateTime = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    return [
      {
        id: "name",
        header: t("files.name"),
        rowHeader: true,
        className: "max-w-64 break-all",
        cell: (file) => file.originalName,
      },
      {
        id: "purpose",
        header: t("files.purpose"),
        cell: (file) => t(`file.purpose.${file.purpose}`),
      },
      {
        id: "type",
        header: t("files.type"),
        cell: (file) => file.extension.toUpperCase(),
      },
      {
        id: "size",
        header: t("files.size"),
        className: "whitespace-nowrap",
        cell: (file) => size(file.sizeBytes),
      },
      {
        id: "createdAt",
        header: t("files.createdAt"),
        className: "whitespace-nowrap",
        cell: (file) => (
          <time dateTime={file.createdAt}>
            {dateTime.format(new Date(file.createdAt))}
          </time>
        ),
      },
      {
        id: "status",
        header: t("files.status"),
        cell: (file) => (
          <Badge tone={file.missing ? "warning" : "neutral"}>
            {t(file.missing ? "files.missing" : "files.available")}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: t("files.actions"),
        cell: (file) => (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => onOpen({ kind: "preview", file })}
            >
              {t("files.preview")}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => onSave(file)}
            >
              {t("files.save")}
            </Button>
            {writable && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => onOpen({ kind: "delete", file })}
              >
                {t("files.delete")}
              </Button>
            )}
          </div>
        ),
      },
    ];
  }, [i18n.resolvedLanguage, onOpen, onSave, pending, t, writable]);

  return (
    <>
      <DataTable
        caption={t("files.title")}
        columns={columns}
        rows={files.data?.items}
        getRowId={(file) => file.id}
        refreshing={files.isFetching}
        emptyView={<EmptyState title={t("files.empty")} />}
        filtered={filtered}
        noMatchView={
          <EmptyState
            title={t("files.empty")}
            description={t("kit.table.noMatch")}
          />
        }
        errorView={
          files.isError ? (
            <ErrorView
              message={t(`errors.${files.error.code}`, files.error.params)}
              detail={t("error.traceId", { traceId: files.error.traceId })}
              onRetry={() => void files.refetch()}
              retrying={files.isFetching}
            />
          ) : undefined
        }
      />
      {files.data && (
        <nav
          aria-label={t("files.pagination")}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p>{t("files.pageInfo", { page, total: files.data.total })}</p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={page === 1 || files.isFetching || pending}
              onClick={() => onPage(page - 1)}
            >
              {t("files.previous")}
            </Button>
            <Button
              variant="ghost"
              disabled={
                page * pageSize >= files.data.total ||
                files.isFetching ||
                pending
              }
              onClick={() => onPage(page + 1)}
            >
              {t("files.next")}
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}
