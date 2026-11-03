import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { useAuthStatus, usePermission } from "@/core/auth";
import { useDeveloperMode } from "@/core/developer-mode";
import { DictTag } from "@/core/dict/dict-tag";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  Button,
  ConfirmDialog,
  DetailPage,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  KeyValueList,
  ScrollArea,
  StatusPage,
} from "@/kit";
import {
  appFilePick,
  demoAttachmentAdd,
  demoAttachmentPreview,
  demoAttachmentRemove,
  demoAttachmentSave,
  demoSampleDelete,
} from "@/lib/generated/commands";
import type { DemoSample } from "@/lib/generated/DemoSample";
import type { FilePreview } from "@/lib/generated/FilePreview";
import type { IpcError } from "@/lib/generated/IpcError";
import { isId } from "@/lib/id";
import { demoKey, sampleQuery } from "./queries";
import { SampleForm } from "./sample-form";
import { useDemoScope } from "./use-demo-scope";

function AttachmentPreview({
  userId,
  id,
  name,
}: {
  userId: string;
  id: string;
  name: string;
}) {
  const { t } = useTranslation();
  const preview = useQuery<FilePreview, IpcError>({
    queryKey: [...demoKey(userId), "attachment-preview", id],
    queryFn: () => demoAttachmentPreview({ id }),
    gcTime: 0,
    retry: false,
  });
  if (preview.isPending) return <StatusPage kind="loading" />;
  if (preview.isError) return <IpcErrorMessage error={preview.error} />;
  return preview.data.type === "image" ? (
    <img
      src={preview.data.dataUrl}
      alt={name}
      className="max-h-[60vh] max-w-full object-contain"
    />
  ) : (
    <>
      {preview.data.truncated && <p role="status">{t("files.truncated")}</p>}
      <ScrollArea axis="both" className="max-h-[60vh]">
        <pre className="whitespace-pre-wrap break-words text-body">
          {preview.data.text}
        </pre>
      </ScrollArea>
    </>
  );
}

export function SampleDetail({
  userId,
  id,
  onDeleted,
}: {
  userId: string;
  id: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const canWrite = usePermission("demo.sample.write");
  const query = useQuery(sampleQuery(userId, id));
  const [editing, setEditing] = useState<DemoSample | null>(null);
  const [confirm, setConfirm] = useState<"sample" | "attachment" | null>(null);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const isCurrent = useDemoScope(userId);
  const action = useMutation<unknown, IpcError, () => Promise<unknown>>({
    mutationFn: (execute) => execute(),
    onSuccess: async () => {
      setConfirm(null);
      await client.invalidateQueries({ queryKey: demoKey(userId) });
    },
    retry: false,
    gcTime: 0,
  });
  if (query.isPending) return <StatusPage kind="loading" />;
  if (query.isError)
    return (
      <StatusPage
        kind={
          query.error.code === "demo.sample.not_found"
            ? "notFound"
            : query.error.code === "app.permission.denied"
              ? "forbidden"
              : "error"
        }
        description={<IpcErrorMessage error={query.error} />}
        onRetry={() => void query.refetch()}
      />
    );
  const sample = query.data;
  const attachment = sample.attachment;
  const version = { id, rowVersion: sample.rowVersion };
  return (
    <DetailPage
      title={sample.title}
      description={sample.code}
      className="p-panel"
      actions={
        <>
          <Button
            variant="outline"
            disabled={query.isFetching || action.isPending}
            onClick={() => {
              action.reset();
              setNotice("");
              void query.refetch();
            }}
          >
            {t("demo.refresh")}
          </Button>
          {canWrite && (
            <>
              <Button
                disabled={action.isPending}
                onClick={() => setEditing(sample)}
              >
                {t("demo.edit")}
              </Button>
              <Button
                variant="destructive"
                disabled={action.isPending}
                onClick={() => {
                  action.reset();
                  setConfirm("sample");
                }}
              >
                {t("demo.delete")}
              </Button>
            </>
          )}
        </>
      }
    >
      <KeyValueList
        items={[
          { key: "code", label: t("demo.sample.code"), value: sample.code },
          {
            key: "stage",
            label: t("demo.sample.stage"),
            value: <DictTag code="demo.sample_stage" value={sample.stage} />,
          },
          {
            key: "count",
            label: t("demo.sample.characterCount"),
            value: sample.characterCount ?? t("demo.unmeasured"),
          },
          {
            key: "version",
            label: t("demo.version"),
            value: sample.rowVersion,
          },
        ]}
      />
      <div className="text-body">
        <h2 className="font-semibold">{t("demo.sample.note")}</h2>
        <p className="whitespace-pre-wrap break-words">{sample.note}</p>
      </div>
      <section
        aria-label={t("demo.sample.attachment")}
        className="flex flex-col gap-stack text-body"
      >
        <h2 className="font-semibold">{t("demo.sample.attachment")}</h2>
        <p>{t("demo.attachmentRules")}</p>
        {attachment ? (
          <>
            <p className="break-all">
              {attachment.name} · {attachment.bytes} B
            </p>
            {attachment.missing && (
              <p role="status">{t("demo.attachmentMissing")}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {!attachment.missing &&
                ["txt", "md", "png"].includes(attachment.extension) && (
                  <Button variant="outline" onClick={() => setPreview(true)}>
                    {t("demo.preview")}
                  </Button>
                )}
              <Button
                variant="outline"
                disabled={action.isPending || attachment.missing}
                onClick={() => {
                  setNotice("");
                  action.mutate(async () => {
                    const file = await appFilePick({
                      purpose: "save",
                      extensions: [attachment.extension],
                      suggestedName: attachment.name,
                    });
                    if (file && isCurrent()) {
                      await demoAttachmentSave({ id, fileToken: file.token });
                      if (isCurrent()) setNotice(t("demo.attachmentSaved"));
                    }
                  });
                }}
              >
                {t("demo.saveCopy")}
              </Button>
              {canWrite && (
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => {
                    action.reset();
                    setConfirm("attachment");
                  }}
                >
                  {t("demo.removeAttachment")}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p>{t("demo.noAttachment")}</p>
            {canWrite && (
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => {
                  setNotice("");
                  action.mutate(async () => {
                    const file = await appFilePick({
                      purpose: "store",
                      extensions: ["txt", "md", "png", "pdf"],
                    });
                    if (file && isCurrent())
                      await demoAttachmentAdd({
                        ...version,
                        fileToken: file.token,
                      });
                  });
                }}
              >
                {t("demo.addAttachment")}
              </Button>
            )}
          </>
        )}
        <p className="text-muted-foreground">{t("demo.attachmentCleanup")}</p>
      </section>
      {notice && <p role="status">{notice}</p>}
      {action.error && confirm === null && (
        <IpcErrorMessage error={action.error} />
      )}
      {editing && canWrite && (
        <SampleForm
          userId={userId}
          sample={editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={confirm !== null && canWrite}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t(
          confirm === "sample" ? "demo.delete" : "demo.removeAttachment",
        )}
        description={
          <>
            <p>{t("demo.attachmentCleanup")}</p>
            {action.error && <IpcErrorMessage error={action.error} />}
          </>
        }
        confirmLabel={t("demo.confirm")}
        tone="destructive"
        pending={action.isPending}
        onConfirm={() =>
          action.mutate(async () => {
            if (confirm === "sample") {
              await demoSampleDelete(version);
              onDeleted();
            } else {
              await demoAttachmentRemove(version);
              setNotice(t("demo.attachmentRemoved"));
            }
          })
        }
      />
      {attachment && (
        <Dialog open={preview} onOpenChange={setPreview}>
          <DialogContent
            aria-describedby={undefined}
            className="flex h-[85vh] flex-col gap-0 p-0"
          >
            <DialogHeader className="shrink-0 px-panel pt-(--panel-pad)">
              <DialogTitle>{attachment.name}</DialogTitle>
            </DialogHeader>
            <ScrollArea
              region="content"
              className="min-h-0 flex-1"
              plateClassName="flex flex-col gap-stack px-panel pt-(--stack-gap) pb-(--panel-pad)"
            >
              {preview && (
                <AttachmentPreview
                  userId={userId}
                  id={id}
                  name={attachment.name}
                />
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </DetailPage>
  );
}

export default function DemoSamplePage() {
  const { id } = useParams<{ id: string }>();
  if (id === undefined || !isId(id)) return <StatusPage kind="notFound" />;
  return <SamplePage id={id} />;
}

function SamplePage({ id }: { id: string }) {
  const auth = useAuthStatus();
  const navigate = useNavigate();
  const developerMode = useDeveloperMode();
  const canRead = usePermission("demo.sample.read");
  if (!developerMode) return <StatusPage kind="notFound" />;
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  if (!canRead) return <StatusPage kind="forbidden" />;
  return (
    <div className="flex flex-col gap-stack p-panel">
      <SampleDetail
        key={`${auth.data.user.id}:${id}:${auth.data.permissions.join(",")}`}
        userId={auth.data.user.id}
        id={id}
        onDeleted={() => navigate("/demo/samples")}
      />
    </div>
  );
}
