import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { useAuthStatus, usePermission } from "@/core/auth";
import { useDeveloperMode } from "@/core/developer-mode";
import { DictTag } from "@/core/dict/dict-tag";
import { IpcErrorMessage } from "@/core/ipc-error";
import { JobProgress } from "@/core/jobs/job-progress";
import {
  Button,
  DetailPage,
  KeyValueList,
  ScrollArea,
  StatusPage,
} from "@/kit";
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
import { isId } from "@/lib/id";
import { subscribeStream } from "@/lib/ipc/stream";
import { demoKey } from "./queries";
import { DemoJobs } from "./submitted-jobs";

function Job({ userId, id }: { userId: string; id: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [live, setLive] = useState<{
    status?: JobStatus;
    progress: Progress;
  }>();
  const [error, setError] = useState<IpcError>();
  const [unknown, setUnknown] = useState<string>();
  const [subscription, setSubscription] = useState({ id });
  const query = useQuery<JobSnapshot, IpcError>({
    queryKey: [...demoKey(userId), "job", id],
    queryFn: () => appJobMineGet({ id }),
    retry: false,
  });
  const cancel = useMutation<null, IpcError>({
    mutationFn: () => appJobMineCancel({ id }),
    retry: false,
  });
  const loaded = query.isSuccess;
  useEffect(() => {
    if (!loaded) return;
    setError(undefined);
    setUnknown(undefined);
    const stream = subscribeStream<JobEvent>(
      (channel) => appJobMineWatch(subscription, channel),
      (event) => {
        if (event.type === "progress")
          setLive((current) => ({ status: current?.status, progress: event }));
        if (event.type === "delta")
          setLive({ status: event.data.status, progress: event.data.progress });
        if (event.type === "unknown") setUnknown(event.reason);
        if (
          ["succeeded", "failed", "cancelled", "unknown"].includes(event.type)
        ) {
          setLive(undefined);
          void client.invalidateQueries({ queryKey: demoKey(userId) });
        }
      },
      setError,
    );
    return () => stream.dispose();
  }, [userId, client, loaded, subscription]);
  if (query.isPending) return <StatusPage kind="loading" />;
  if (query.isError)
    return (
      <StatusPage
        kind={
          query.error.code === "app.data.not_found"
            ? "notFound"
            : query.error.code === "app.permission.denied"
              ? "forbidden"
              : "error"
        }
        description={<IpcErrorMessage error={query.error} />}
        onRetry={() => void query.refetch()}
      />
    );
  const job = query.data;
  const status = live?.status ?? job.status;
  return (
    <DetailPage title={t("demo.job")} description={t(`jobs.kinds.${job.kind}`)}>
      <KeyValueList
        items={[
          { key: "id", label: t("jobs.id"), value: id },
          {
            key: "status",
            label: t("jobs.status"),
            value: <DictTag code="framework.job_status" value={status} />,
          },
        ]}
      />
      <JobProgress progress={live?.progress ?? job.progress} status={status} />
      <p className="text-body">{t("demo.jobHint")}</p>
      <div className="flex gap-2">
        {(status === "queued" || status === "running") && (
          <Button
            disabled={
              cancel.isPending || cancel.isSuccess || job.cancelRequested
            }
            onClick={() => cancel.mutate()}
          >
            {t(
              cancel.isPending || cancel.isSuccess || job.cancelRequested
                ? "jobs.cancelRequested"
                : "jobs.cancel",
            )}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            setSubscription({ id });
            void query.refetch();
          }}
        >
          {t("demo.refresh")}
        </Button>
      </div>
      {error && <IpcErrorMessage error={error} />}
      {cancel.error && <IpcErrorMessage error={cancel.error} />}
      {unknown && <p role="alert">{t(unknown)}</p>}
      {job.errorCode && (
        <p role="alert">{t(`errors.${job.errorCode}`, job.errorParams)}</p>
      )}
      {job.result !== null && (
        <section className="text-body">
          <h2 className="font-semibold">{t("jobs.result")}</h2>
          <ScrollArea axis="both">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(job.result, null, 2)}
            </pre>
          </ScrollArea>
        </section>
      )}
    </DetailPage>
  );
}

export default function DemoJobPage() {
  const { id } = useParams<{ id: string }>();
  if (id === undefined || !isId(id)) return <StatusPage kind="notFound" />;
  return <JobPage id={id} />;
}

function JobPage({ id }: { id: string }) {
  const auth = useAuthStatus();
  const developerMode = useDeveloperMode();
  const canRead = usePermission("demo.sample.read");
  if (!developerMode) return <StatusPage kind="notFound" />;
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  if (!canRead) return <StatusPage kind="forbidden" />;
  return (
    <div className="flex flex-col gap-stack p-panel">
      <Job
        key={`${auth.data.user.id}:${id}:${auth.data.permissions.join(",")}`}
        userId={auth.data.user.id}
        id={id}
      />
      <DemoJobs userId={auth.data.user.id} />
    </div>
  );
}
