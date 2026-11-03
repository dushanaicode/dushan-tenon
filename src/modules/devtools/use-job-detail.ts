import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { devtoolsJobGet, devtoolsJobWatch } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobDetail } from "@/lib/generated/JobDetail";
import type { JobEvent } from "@/lib/generated/JobEvent";
import type { JobProgress } from "@/lib/generated/JobProgress";
import type { JobStatus } from "@/lib/generated/JobStatus";
import { subscribeStream } from "@/lib/ipc/stream";

export function jobUnavailable(error: Pick<IpcError, "code">) {
  return (
    error.code === "app.data.not_found" ||
    error.code === "app.permission.denied" ||
    error.code === "app.module.disabled" ||
    error.code.startsWith("account.auth.") ||
    error.code.startsWith("account.session.")
  );
}

export function useJobDetail(id: string, onUnavailable?: () => void) {
  const client = useQueryClient();
  const [subscription, setSubscription] = useState({ id });
  const job = useQuery<JobDetail, IpcError>({
    queryKey: ["devtools", "job", id],
    queryFn: async ({ signal }) => {
      const detail = await devtoolsJobGet({ id });
      signal.throwIfAborted();
      return detail;
    },
    enabled: false,
    gcTime: 0,
    retry: false,
  });
  const { refetch } = job;
  const [progress, setProgress] = useState<JobProgress>();
  const [status, setStatus] = useState<JobStatus>();
  const [streamError, setStreamError] = useState<IpcError>();
  const [failure, setFailure] = useState<Pick<IpcError, "code" | "params">>();
  const [unknown, setUnknown] = useState<string>();
  const unavailable = [job.error, streamError, failure].some(
    (error) => error && jobUnavailable(error),
  );
  useEffect(() => {
    if (unavailable) onUnavailable?.();
  }, [unavailable, onUnavailable]);
  useEffect(() => {
    let disposed = false;
    const subscriptionHandle = subscribeStream<JobEvent>(
      (channel) => devtoolsJobWatch(subscription, channel),
      (event) => {
        switch (event.type) {
          case "progress":
            setProgress(event);
            break;
          case "delta":
            setStatus(event.data.status);
            setProgress(event.data.progress);
            break;
          case "succeeded":
          case "failed":
          case "cancelled":
          case "unknown":
            setStatus(undefined);
            setProgress(undefined);
            if (event.type === "failed") setFailure(event);
            if (event.type === "unknown") setUnknown(event.reason);
            // 首个快照仍在途时也必须另读终态，不能复用那次请求。
            void client
              .cancelQueries({ queryKey: ["devtools", "job", id], exact: true })
              .then(() => {
                if (!disposed) void refetch({ cancelRefetch: false });
              });
            break;
        }
      },
      setStreamError,
    );
    // 先安装观察，再读取快照，避免两者之间漏掉更新。
    void refetch();
    return () => {
      disposed = true;
      subscriptionHandle.dispose();
    };
  }, [id, refetch, client, subscription]);
  const restart = () => {
    setProgress(undefined);
    setStatus(undefined);
    setStreamError(undefined);
    setFailure(undefined);
    setUnknown(undefined);
    setSubscription({ id });
  };
  return {
    job,
    progress,
    status,
    streamError,
    failure,
    unknown,
    unavailable,
    restart,
  };
}
