import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import { JobProgress } from "@/core/jobs/job-progress";
import { Button } from "@/kit";
import {
  appJobMineCancel,
  appJobMineGet,
  appJobMineWatch,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobEvent } from "@/lib/generated/JobEvent";
import type { JobProgress as Progress } from "@/lib/generated/JobProgress";
import type { JobSnapshot } from "@/lib/generated/JobSnapshot";
import type { JobStatus } from "@/lib/generated/JobStatus";
import { subscribeStream } from "@/lib/ipc/stream";

const emptyProgress: Progress = {
  current: null,
  total: null,
  messageKey: null,
  params: {},
};

export function useExchangeJob(id: string | undefined, onComplete: () => void) {
  const [detail, setDetail] = useState<JobSnapshot>();
  const [error, setError] = useState<IpcError>();
  const [cancelError, setCancelError] = useState<IpcError>();
  const [progress, setProgress] = useState(emptyProgress);
  const [status, setStatus] = useState<JobStatus>("queued");
  const [cancelling, setCancelling] = useState(false);
  const completion = useRef(onComplete);
  const generation = useRef(0);
  useEffect(() => {
    completion.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    generation.current += 1;
    setDetail(undefined);
    setError(undefined);
    setCancelError(undefined);
    setStatus("queued");
    setProgress(emptyProgress);
    setCancelling(false);
    if (!id) return;
    let disposed = false;
    const stream = subscribeStream<JobEvent>(
      (channel) => appJobMineWatch({ id }, channel),
      (event) => {
        if (event.type === "progress") {
          setProgress(event);
          setStatus("running");
        }
        if (event.type === "delta") {
          setStatus(event.data.status);
          setProgress(event.data.progress);
        }
        if (
          ["succeeded", "failed", "cancelled", "unknown"].includes(event.type)
        ) {
          void appJobMineGet({ id })
            .then((result) => {
              if (disposed) return;
              setDetail(result);
              setStatus(result.status);
              setProgress(result.progress);
              setCancelling(false);
              completion.current();
            })
            .catch((error: IpcError) => {
              if (!disposed) setError(error);
            });
        }
      },
      setError,
    );
    return () => {
      disposed = true;
      generation.current += 1;
      stream.dispose();
    };
  }, [id]);
  const active = Boolean(id) && !detail && !error;
  return {
    detail,
    error: error ?? cancelError,
    progress,
    status,
    active,
    cancelling,
    cancel: async () => {
      if (!id) return;
      const requestGeneration = generation.current;
      setCancelError(undefined);
      setCancelling(true);
      try {
        await appJobMineCancel({ id });
      } catch (error) {
        if (generation.current !== requestGeneration) return;
        setCancelError(error as IpcError);
        setCancelling(false);
      }
    },
  };
}

export function ExchangeJob({
  job,
}: {
  job: ReturnType<typeof useExchangeJob>;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <JobProgress progress={job.progress} status={job.status} />
      {job.active && (
        <Button
          type="button"
          variant="ghost"
          disabled={job.cancelling}
          onClick={() => void job.cancel()}
        >
          {t("exchange.cancel")}
        </Button>
      )}
      {job.error && <IpcErrorMessage error={job.error} />}
      {job.detail?.errorCode && (
        <p role="alert">
          {t(`errors.${job.detail.errorCode}`, job.detail.errorParams)}
        </p>
      )}
      {job.status === "cancelled" && (
        <p role="status">{t("exchange.cancelled")}</p>
      )}
    </div>
  );
}
