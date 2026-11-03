import {
  focusManager,
  onlineManager,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, ConfirmDialog, Loading, Progress } from "@/kit";
import {
  appNativeSettingsGet,
  appOperationCancel,
  appUpdateCheck,
  appUpdateDownload,
  appUpdateInstall,
  appUpdateStatus,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { NativeSettings } from "@/lib/generated/NativeSettings";
import type { OperationProgress } from "@/lib/generated/OperationProgress";
import type { UpdateState } from "@/lib/generated/UpdateState";
import { subscribeStream } from "@/lib/ipc/stream";

function suspendUpdateQueries() {
  const wasOnline = onlineManager.isOnline();
  let paused = true;
  onlineManager.setEventListener((setOnline) => {
    const online = () => {
      if (!paused) setOnline(true);
    };
    const offline = () => {
      if (!paused) setOnline(false);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  });
  onlineManager.setOnline(false);
  focusManager.setFocused(false);
  return () => {
    paused = false;
    onlineManager.setOnline(wasOnline);
    focusManager.setFocused(undefined);
  };
}

export function UpdatePanel() {
  const auth = useAuthStatus();
  const settings = useQuery<NativeSettings, IpcError>({
    queryKey: ["app", "native-settings", auth.data?.user?.id],
    queryFn: appNativeSettingsGet,
    enabled: auth.data?.state === "active",
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  if (!settings.data) return null;
  return (
    <ConfiguredUpdatePanel
      key={`${auth.data?.user?.id}:${auth.data?.permissions.join(",")}`}
      canEdit={settings.data.canEdit}
    />
  );
}

function ConfiguredUpdatePanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const auth = useAuthStatus();
  const [snapshot, setSnapshot] = useState<UpdateState | null>(null);
  const [error, setError] = useState<IpcError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const mounted = useRef(true);
  const stream = useRef<ReturnType<
    typeof subscribeStream<OperationProgress>
  > | null>(null);
  const status = useQuery<UpdateState, IpcError>({
    queryKey: ["app", "update", auth.data?.user?.id],
    queryFn: appUpdateStatus,
    enabled: !stopped,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stream.current?.dispose(false);
    };
  }, []);
  const current = snapshot ?? status.data;
  const release = current && "release" in current ? current.release : null;
  const failure =
    error ?? (current && "error" in current ? current.error : null);
  const unavailable = busy || !canEdit || stopped;
  const observing =
    current?.status === "checking" || current?.status === "downloading";

  async function refreshStatus() {
    setBusy(true);
    setError(null);
    const result = await status.refetch();
    if (mounted.current) {
      if (result.isError) setError(result.error);
      if (result.isSuccess) setSnapshot(result.data);
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const next = await appUpdateCheck();
      if (mounted.current) setSnapshot(next);
    } catch (failure) {
      if (mounted.current) {
        const error = failure as IpcError;
        setError(error);
        setSnapshot({ status: "failed", error });
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function download(updateId: string) {
    setBusy(true);
    setError(null);
    setProgress(null);
    setCancelRequested(false);
    stream.current = subscribeStream<OperationProgress>(
      async (channel) => {
        try {
          const next = await appUpdateDownload({ updateId }, channel);
          if (mounted.current) setSnapshot(next);
        } catch (failure) {
          if (mounted.current) {
            const error = failure as IpcError;
            setError(error);
            setSnapshot({ status: "failed", error });
          }
        } finally {
          if (mounted.current) {
            setBusy(false);
            setProgress(null);
          }
        }
      },
      (event) => {
        if (mounted.current && event.type === "delta") setProgress(event.data);
      },
      (error) => {
        if (mounted.current) setError(error);
      },
    );
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

  async function install(updateId: string) {
    setBusy(true);
    setError(null);
    // cleanup hides and re-shows main on failure. Suppress auth/focus/reconnect
    // queries before that happens; only rejection before shutdown can resume them.
    const resumeQueries = suspendUpdateQueries();
    await client.cancelQueries();
    try {
      await appUpdateInstall({ updateId });
    } catch (failure) {
      const error = failure as IpcError;
      if (error.code !== "app.update.install_failed") resumeQueries();
      if (mounted.current) {
        setError(error);
        if (error.code === "app.update.install_failed") {
          setStopped(true);
          setSnapshot({ status: "stoppedAfterInstallFailure", error });
        }
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        setConfirm(false);
      }
    }
    // 安装命令结果为终态；宿主关闭后不再发起认证查询。
  }

  if (status.isError && snapshot === null)
    return <IpcErrorMessage error={status.error} />;
  if (!current) return <Loading label={t("kit.loading")} />;
  if (current.status === "unconfigured")
    return <p role="status">{t("settings.update.unconfigured")}</p>;
  return (
    <section aria-labelledby="update-title" className="space-y-3 border-t pt-4">
      <h3 id="update-title" className="text-lg font-semibold">
        {t("settings.update.title")}
      </h3>
      {stopped ? (
        <p role="alert" className="text-body">
          {t("settings.update.stoppedAfterFailure")}
        </p>
      ) : (
        <>
          {current?.status === "upToDate" && (
            <p className="text-body">{t("settings.update.upToDate")}</p>
          )}
          {release && (
            <div className="space-y-2">
              <p className="text-body">
                {t("settings.update.version")}: {release.version}
              </p>
              <p className="text-body">
                {t("settings.update.bytes")}:{" "}
                {release.bytes ?? t("settings.update.unknownSize")}
              </p>
              {release.publishedAt && (
                <p className="text-body">{release.publishedAt}</p>
              )}
              <p className="whitespace-pre-wrap break-words text-body">
                {release.notes}
              </p>
              <p className="text-body">
                {t(
                  current?.status === "verified"
                    ? "settings.update.signatureVerified"
                    : "settings.update.signaturePending",
                )}
              </p>
            </div>
          )}
          {progress && (
            <div className="space-y-2" aria-live="polite">
              <Progress
                value={
                  progress.total && progress.current !== null
                    ? (progress.current / progress.total) * 100
                    : undefined
                }
              />
              <p className="text-body">
                {t("settings.update.downloading")}: {progress.current ?? 0} /{" "}
                {progress.total ?? t("settings.update.unknownSize")}
              </p>
              <Button
                variant="outline"
                disabled={!progress.canCancel || cancelRequested}
                onClick={() => void cancel(progress.operationId)}
              >
                {t("settings.update.cancel")}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || stopped || (!observing && !canEdit)}
              onClick={() => void (observing ? refreshStatus() : check())}
            >
              {t(
                observing
                  ? "settings.native.refresh"
                  : busy && progress === null
                    ? "settings.update.checking"
                    : "settings.update.check",
              )}
            </Button>
            {current?.status === "available" && (
              <Button
                disabled={unavailable}
                onClick={() => download(current.release.updateId)}
              >
                {t("settings.update.download")}
              </Button>
            )}
            {current?.status === "verified" && (
              <Button disabled={unavailable} onClick={() => setConfirm(true)}>
                {t("settings.update.install")}
              </Button>
            )}
          </div>
        </>
      )}
      {failure && <IpcErrorMessage error={failure} />}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("settings.update.install")}
        description={t("settings.update.confirmRestart")}
        confirmLabel={t("settings.update.install")}
        pending={busy}
        onConfirm={() => {
          if (release) return install(release.updateId);
        }}
      />
    </section>
  );
}
