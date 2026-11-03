import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { usePermission } from "@/core/auth";
import { DictTag } from "@/core/dict/dict-tag";
import { IpcErrorMessage } from "@/core/ipc-error";
import { JobProgress } from "@/core/jobs/job-progress";
import { Button, PageHeader, ScrollArea, StatusPage } from "@/kit";
import {
  devtoolsJobCancel,
  devtoolsJobResolve,
  devtoolsJobRetry,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobStatus } from "@/lib/generated/JobStatus";
import { isId } from "@/lib/id";
import { useJobDetail } from "./use-job-detail";

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (id === undefined || !isId(id)) return <StatusPage kind="notFound" />;
  return <JobView key={id} id={id} />;
}

export function JobView({
  id,
  onUnavailable,
}: {
  id: string;
  onUnavailable?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const {
    job,
    progress,
    status,
    streamError,
    failure,
    unknown,
    unavailable,
    restart,
  } = useJobDetail(id, onUnavailable);
  const dateTime = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  if (unavailable && onUnavailable) return null;
  return (
    <section className="mx-auto max-w-3xl space-y-6 py-10">
      <Link to="/devtools/jobs" className="text-primary underline">
        {t("jobs.back")}
      </Link>
      <PageHeader title={t("jobs.detail")} />
      {job.isPending && !streamError && !failure && (
        <p role="status">{t("jobs.loading")}</p>
      )}
      {job.error && <IpcErrorMessage error={job.error} />}
      {streamError && <IpcErrorMessage error={streamError} />}
      {failure && !job.data?.errorCode && (
        <p role="alert">{t(`errors.${failure.code}`, failure.params)}</p>
      )}
      {unknown && <p role="alert">{t(unknown)}</p>}
      {job.data && !unavailable && (
        <>
          <h2 className="text-xl font-medium">
            {t(`jobs.kinds.${job.data.kind}`)}
          </h2>
          <p role="status">
            <DictTag
              code="framework.job_status"
              value={status ?? job.data.status}
            />
          </p>
          <JobProgress
            progress={progress ?? job.data.progress}
            status={status ?? job.data.status}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 rounded-lg border border-border p-5">
            <dt>{t("jobs.id")}</dt>
            <dd className="break-all font-mono">{id}</dd>
            <dt>{t("jobs.attempts")}</dt>
            <dd>
              {job.data.attempts} / {job.data.maxAttempts}
            </dd>
            <dt>{t("jobs.submitter")}</dt>
            <dd>
              {t(job.data.submittedBy ? "account.user.owner" : "jobs.system")}
            </dd>
            {(["createdAt", "startedAt", "finishedAt"] as const).map((key) => (
              <div key={key} className="contents">
                <dt>{t(`jobs.${key}`)}</dt>
                <dd>
                  {job.data[key] ? (
                    <time dateTime={job.data[key]}>
                      {dateTime.format(new Date(job.data[key]))}
                    </time>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {job.data.errorCode && (
            <p role="alert">
              {t(`errors.${job.data.errorCode}`, job.data.errorParams)}
            </p>
          )}
          {job.data.result !== null && (
            <div className="space-y-2">
              <h2 className="font-medium">{t("jobs.result")}</h2>
              <ScrollArea axis="both" className="rounded-lg bg-muted p-4">
                <pre>{JSON.stringify(job.data.result, null, 2)}</pre>
              </ScrollArea>
            </div>
          )}
          <JobActions
            id={id}
            status={status ?? job.data.status}
            cancelRequested={job.data.cancelRequested}
            onSuccess={restart}
            onError={() => void job.refetch()}
          />
        </>
      )}
    </section>
  );
}

function JobActions({
  id,
  status,
  cancelRequested,
  onSuccess,
  onError,
}: {
  id: string;
  status: JobStatus;
  cancelRequested?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const canWrite = usePermission("devtools.job.write");
  const action = useMutation<
    null,
    IpcError,
    "cancel" | "retry" | "succeeded" | "failed"
  >({
    mutationFn: (kind) =>
      kind === "cancel"
        ? devtoolsJobCancel({ id })
        : kind === "retry"
          ? devtoolsJobRetry({ id })
          : devtoolsJobResolve({ id, outcome: kind }),
    onSuccess,
    onError,
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ["devtools"] });
    },
  });
  return (
    <div className="space-y-3">
      {action.isError && <IpcErrorMessage error={action.error} />}
      {canWrite && (
        <div className="flex flex-wrap gap-3">
          {(status === "queued" || status === "running") && (
            <Button
              variant="ghost"
              disabled={action.isPending || cancelRequested}
              onClick={() => action.mutate("cancel")}
            >
              {t(cancelRequested ? "jobs.cancelRequested" : "jobs.cancel")}
            </Button>
          )}
          {(status === "failed" ||
            status === "cancelled" ||
            status === "needs_review") && (
            <Button
              disabled={action.isPending}
              onClick={() => action.mutate("retry")}
            >
              {t("jobs.retry")}
            </Button>
          )}
          {status === "needs_review" && (
            <>
              <p className="basis-full text-muted-foreground">
                {t("jobs.resolveHint")}
              </p>
              <Button
                disabled={action.isPending}
                onClick={() => action.mutate("succeeded")}
              >
                {t("jobs.resolveSucceeded")}
              </Button>
              <Button
                variant="ghost"
                disabled={action.isPending}
                onClick={() => action.mutate("failed")}
              >
                {t("jobs.resolveFailed")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
