import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authKey, useAuthStatus, usePermission } from "@/core/auth";
import { useIncomingFile } from "@/core/file-ingress";
import { IpcErrorMessage } from "@/core/ipc-error";
import { usePageSession } from "@/core/page-session";
import { Button, PageHeader, ScrollArea } from "@/kit";
import {
  appFilePick,
  filesFileAdd,
  filesFileDelete,
  filesFileList,
  filesFilePurposes,
  filesFileReclaim,
  filesFileSaveCopy,
} from "@/lib/generated/commands";
import type { FilePurposes } from "@/lib/generated/FilePurposes";
import type { FileSummary } from "@/lib/generated/FileSummary";
import type { IpcError } from "@/lib/generated/IpcError";
import type { Page } from "@/lib/generated/Page";
import type { ReclaimReport } from "@/lib/generated/ReclaimReport";
import { FileDialog, Preview } from "./file-dialog";
import { FileTable, pageSize, size } from "./file-table";
import { FileToolbar } from "./file-toolbar";

type FileDialogState =
  | { kind: "preview" | "delete"; file: FileSummary }
  | { kind: "reclaim" };

export function FilesPage() {
  const auth = useAuthStatus();
  const readable = usePermission("files.file.read");
  if (!readable || !auth.data?.user) return null;
  const scope = `${auth.data.user.id}:${auth.data.mode}:${auth.data.permissions.join(",")}`;
  return <FilesList key={scope} userId={auth.data.user.id} />;
}

function FilesList({ userId }: { userId: string }) {
  const incoming = useIncomingFile("files.add");
  const { t } = useTranslation();
  const client = useQueryClient();
  const writable = usePermission("files.file.write");
  const filesKey = ["files", userId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { view, update, restoreScroll } = usePageSession(
    userId,
    "files.list",
    { page: 1, purpose: "", keyword: "" },
    scrollRef,
  );
  const { page, purpose, keyword } = view;
  const [dialog, setDialog] = useState<FileDialogState | null>(null);
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<ReclaimReport>();
  const purposes = useQuery<FilePurposes, IpcError>({
    queryKey: [...filesKey, "purposes"],
    queryFn: filesFilePurposes,
  });
  const files = useQuery<Page<FileSummary>, IpcError>({
    queryKey: [...filesKey, "list", page, purpose, keyword],
    queryFn: async ({ signal }) => {
      const result = await filesFileList({
        page,
        pageSize,
        purpose: purpose || undefined,
        keyword: keyword || undefined,
      });
      signal.throwIfAborted();
      return result;
    },
  });
  useLayoutEffect(
    () => (files.isSuccess ? restoreScroll() : undefined),
    [files.isSuccess, restoreScroll],
  );
  const selected = purposes.data?.items.find((item) => item.code === purpose);
  const mutation = useMutation<unknown, IpcError, () => Promise<unknown>>({
    mutationFn: (action) => action(),
    gcTime: 0,
    onSuccess: async () => {
      if (!mounted.current) return;
      setDialog(null);
      await client.invalidateQueries({ queryKey: [...filesKey, "list"] });
    },
    onError: async (error) => {
      if (
        mounted.current &&
        [
          "app.data.not_found",
          "app.data.version_conflict",
          "app.file.missing",
        ].includes(error.code)
      )
        await client.invalidateQueries({ queryKey: filesKey });
    },
  });
  const pending = mutation.isPending;
  const open = useCallback(
    (next: FileDialogState) => {
      mutation.reset();
      setNotice("");
      setReport(undefined);
      setDialog(next);
    },
    [mutation.reset],
  );
  // A picker can outlive this page's identity or permission scope.
  const currentScope = useCallback(
    (auth: unknown) => {
      return mounted.current && client.getQueryData(authKey) === auth;
    },
    [client],
  );
  function add() {
    if (!selected) return;
    const auth = client.getQueryData(authKey);
    setNotice("");
    mutation.mutate(async () => {
      const source =
        incoming?.file ??
        (await appFilePick({
          purpose: "store",
          extensions: selected.extensions,
        }));
      if (!source || !currentScope(auth)) return;
      try {
        await filesFileAdd({ purpose: selected.code, fileToken: source.token });
      } finally {
        incoming?.clear();
      }
      if (currentScope(auth)) setNotice(t("files.added"));
    });
  }
  const save = useCallback(
    (file: FileSummary) => {
      const auth = client.getQueryData(authKey);
      setNotice("");
      mutation.mutate(async () => {
        const target = await appFilePick({
          purpose: "save",
          extensions: [file.extension],
          suggestedName: file.originalName,
        });
        if (!target || !currentScope(auth)) return;
        await filesFileSaveCopy({ id: file.id, fileToken: target.token });
        if (currentScope(auth)) setNotice(t("files.saved"));
      });
    },
    [client, currentScope, mutation.mutate, t],
  );
  return (
    <ScrollArea
      ref={scrollRef}
      region="content"
      role="region"
      aria-label={t("files.localOnly")}
      className="h-full min-h-0"
      plateClassName="mx-auto max-w-7xl space-y-6 p-page"
    >
      <PageHeader title={t("files.title")} description={t("files.localOnly")} />
      <FileToolbar
        purpose={purpose}
        keyword={keyword}
        purposes={purposes.data}
        selected={selected}
        incoming={incoming}
        pending={pending}
        writable={writable}
        onFilter={(patch) => update({ ...patch, page: 1 }, true)}
        onAdd={add}
        onReclaim={() => open({ kind: "reclaim" })}
      />
      {purposes.isError && <IpcErrorMessage error={purposes.error} />}
      {mutation.isError && !dialog && (
        <IpcErrorMessage error={mutation.error} />
      )}
      {notice && <p role="status">{notice}</p>}
      {report && (
        <p role="status">
          {t("files.report", { ...report, bytes: size(report.orphanBytes) })}
        </p>
      )}
      <FileTable
        files={files}
        page={page}
        filtered={purpose !== "" || keyword !== ""}
        pending={pending}
        writable={writable}
        onPage={(page) => update({ page }, true)}
        onOpen={open}
        onSave={save}
      />
      {dialog && (
        <FileDialog
          title={t(`files.${dialog.kind}`)}
          busy={pending}
          close={() => setDialog(null)}
          actions={
            dialog.kind === "preview" ? (
              <Button disabled={pending} onClick={() => save(dialog.file)}>
                {t("files.save")}
              </Button>
            ) : (
              <Button
                disabled={pending}
                onClick={() =>
                  mutation.mutate(async () => {
                    if (dialog.kind === "delete") {
                      await filesFileDelete({
                        id: dialog.file.id,
                        rowVersion: dialog.file.rowVersion,
                      });
                      if (mounted.current) setNotice(t("files.deleted"));
                    } else {
                      const result = await filesFileReclaim();
                      if (mounted.current) setReport(result);
                    }
                  })
                }
              >
                {t("files.confirm")}
              </Button>
            )
          }
        >
          {dialog.kind === "preview" ? (
            <Preview file={dialog.file} userId={userId} />
          ) : (
            <p>
              {dialog.kind === "delete"
                ? t("files.confirmDelete", { name: dialog.file.originalName })
                : t("files.confirmReclaim")}
            </p>
          )}
          {mutation.isError && <IpcErrorMessage error={mutation.error} />}
        </FileDialog>
      )}
    </ScrollArea>
  );
}
