import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authKey, useAuthStatus } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  Button,
  ConfirmDialog,
  Loading,
  Progress,
  SettingGroup,
  SettingRow,
} from "@/kit";
import {
  appBackupExport,
  appBackupPrepareRestore,
  appBackupRestore,
  appDataStatus,
  appFilePick,
  appOperationCancel,
} from "@/lib/generated/commands";
import type { DataStatus } from "@/lib/generated/DataStatus";
import type { FileArtifact } from "@/lib/generated/FileArtifact";
import type { IpcError } from "@/lib/generated/IpcError";
import type { OperationProgress } from "@/lib/generated/OperationProgress";
import type { RestorePlan } from "@/lib/generated/RestorePlan";
import { subscribeStream } from "@/lib/ipc/stream";

export function DataSection() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const auth = useAuthStatus();
  const status = useQuery<DataStatus, IpcError>({
    queryKey: ["app", "data", auth.data?.user?.id],
    queryFn: appDataStatus,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [artifact, setArtifact] = useState<FileArtifact | null>(null);
  const [error, setError] = useState<IpcError | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [committing, setCommitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const mounted = useRef(true);
  const subscription = useRef<ReturnType<
    typeof subscribeStream<OperationProgress>
  > | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      subscription.current?.dispose(false);
    };
  }, []);

  async function start(kind: "backup" | "restore") {
    setConfirm(false);
    setPending(true);
    setCancelRequested(false);
    setProgress(null);
    setArtifact(null);
    setError(null);
    setPlan(null);
    try {
      const selected = await appFilePick({
        purpose: kind === "backup" ? "backupexport" : "backuprestore",
      });
      if (!selected) {
        if (mounted.current) setPending(false);
        return;
      }
      if (!mounted.current) return;
      subscription.current = subscribeStream<OperationProgress>(
        async (channel) => {
          try {
            if (kind === "backup") {
              const result = await appBackupExport(
                { fileToken: selected.token },
                channel,
              );
              if (mounted.current) setArtifact(result);
            } else {
              const result = await appBackupPrepareRestore(
                { fileToken: selected.token },
                channel,
              );
              if (mounted.current) setPlan(result);
            }
          } catch (failure) {
            if (mounted.current) setError(failure as IpcError);
          } finally {
            if (mounted.current) {
              setPending(false);
              setProgress(null);
            }
            // 维护已结束：真实重取期间保留的数据，不等下一次窗口聚焦。
            if (kind === "backup") await refreshAfterMaintenance();
          }
        },
        (event) => {
          if (event.type === "delta") setProgress(event.data);
        },
        setError,
      );
    } catch (failure) {
      if (mounted.current) {
        setError(failure as IpcError);
        setPending(false);
      }
    }
  }

  async function refreshAfterMaintenance() {
    await Promise.all([
      client.invalidateQueries({ queryKey: authKey }),
      client.invalidateQueries({
        queryKey: ["app", "setting", auth.data?.user?.id],
      }),
    ]);
  }

  async function restore() {
    if (!plan) return;
    setCommitting(true);
    setError(null);
    try {
      await appBackupRestore({ preparedId: plan.preparedId });
      if (mounted.current) {
        setAccepted(true);
        setPlan(null);
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure as IpcError);
        setPlan(null);
      }
      await refreshAfterMaintenance();
    } finally {
      if (mounted.current) setCommitting(false);
    }
  }

  async function cancel(operationId: string) {
    setCancelRequested(true);
    try {
      await appOperationCancel({ operationId });
    } catch (failure) {
      if (mounted.current) {
        setError(failure as IpcError);
        setCancelRequested(false);
      }
    }
  }

  if (status.isPending) return <Loading label={t("kit.loading")} />;
  if (status.isError) return <IpcErrorMessage error={status.error} />;
  const unavailable =
    status.data.availability === "remoteDatabase" ||
    status.data.availability === "unsupportedStorage";
  const busy = pending || committing || accepted;
  return (
    <section
      className="flex flex-col gap-stack"
      aria-label={t("settings.sections.data")}
    >
      <SettingGroup title={t("settings.data.backup")}>
        <p className="text-body">{t("settings.data.includesPrivateData")}</p>
        <p className="text-body">{t("settings.data.unencrypted")}</p>
        <p className="text-body text-muted-foreground">
          {t("settings.data.secretsExcluded")}
        </p>
        <p className="text-body text-muted-foreground">
          {t("settings.data.limits")}
        </p>
        {unavailable && (
          <p role="status" className="text-body">
            {t(
              status.data.availability === "remoteDatabase"
                ? "settings.data.remoteDatabase"
                : "settings.data.storageLayout",
            )}
          </p>
        )}
        {status.data.availability === "unsupportedCache" && (
          <p role="status" className="text-body">
            {t("settings.data.unavailableCache")}
          </p>
        )}
        {status.data.lastRestore && (
          <p role="status" className="text-body">
            {t(
              status.data.lastRestore.status === "succeeded"
                ? "settings.data.restored"
                : status.data.lastRestore.status === "rolledBack"
                  ? "settings.data.rolledBack"
                  : "settings.data.restoreFailed",
            )}
          </p>
        )}
        {!status.data.canManage && (
          <p className="text-body">{t("settings.data.ownerRequired")}</p>
        )}
        <SettingRow label={t("settings.data.backup")}>
          {() => (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || unavailable || !status.data.canManage}
                onClick={() => setConfirm(true)}
              >
                {t("settings.data.backup")}
              </Button>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  status.data.availability !== "sqlite" ||
                  !status.data.canManage
                }
                onClick={() => void start("restore")}
              >
                {t("settings.data.verify")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void status.refetch()}
              >
                {t("settings.data.refresh")}
              </Button>
            </div>
          )}
        </SettingRow>
        {pending && (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <p>
              {progress
                ? t(`settings.operations.phase.${progress.phase}`)
                : t("settings.data.busy")}
            </p>
            <Progress
              aria-label={t("settings.data.backup")}
              value={
                progress?.total && progress.current !== null
                  ? (progress.current / progress.total) * 100
                  : undefined
              }
            />
            <p className="text-body">
              {progress?.current === null || !progress
                ? t("settings.data.unknownProgress")
                : t("settings.data.progressBytes", {
                    current: progress.current,
                    total: progress.total ?? "—",
                  })}
            </p>
            <Button
              variant="outline"
              disabled={!progress?.canCancel || cancelRequested}
              onClick={() => {
                if (progress) void cancel(progress.operationId);
              }}
            >
              {t(
                cancelRequested
                  ? "settings.data.cancelling"
                  : "settings.data.cancel",
              )}
            </Button>
          </div>
        )}
        {artifact && (
          <p role="status" className="text-body break-all">
            {t("settings.data.exported", artifact)}
          </p>
        )}
        {error && <IpcErrorMessage error={error} />}
        {accepted && (
          <p role="status" className="text-body">
            {t("settings.data.accepted")}
          </p>
        )}
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("settings.data.backup")}
          description={t("settings.data.unencrypted")}
          confirmLabel={t("settings.data.confirmExport")}
          onConfirm={() => start("backup")}
        />
        <ConfirmDialog
          open={plan !== null}
          onOpenChange={(open) => {
            if (!open) setPlan(null);
          }}
          pending={committing}
          title={t("settings.data.restore")}
          description={
            <span className="flex flex-col gap-2">
              <span>{t("settings.data.overwriteConfirm")}</span>
              {plan && (
                <span>
                  {t("settings.data.preview", {
                    product: plan.productId,
                    version: plan.appVersion,
                    created: plan.createdAt,
                    entries: plan.entries,
                    bytes: plan.totalBytes,
                  })}
                </span>
              )}
              {plan?.requiresUpgrade && (
                <span>{t("settings.data.upgrade")}</span>
              )}
              <span>{t("settings.data.unencrypted")}</span>
              <span>{t("settings.data.secretsExcluded")}</span>
              <span>{t("settings.data.deviceSettingsPreserved")}</span>
              <span>{t("settings.data.restartRequired")}</span>
            </span>
          }
          confirmLabel={t("settings.data.confirmRestore")}
          onConfirm={restore}
        />
      </SettingGroup>
    </section>
  );
}
