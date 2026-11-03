import { useTranslation } from "react-i18next";
import type { ObjectViewProps } from "@/core/contracts/module";
import { DictTag } from "@/core/dict/dict-tag";
import { IpcErrorMessage } from "@/core/ipc-error";
import { JobProgress } from "@/core/jobs/job-progress";
import { KeyValueList } from "@/kit";
import { useJobDetail } from "./use-job-detail";

export function JobInspector({ object, onUnavailable }: ObjectViewProps) {
  return (
    <Inspector
      key={object.ref.id}
      id={object.ref.id}
      onUnavailable={onUnavailable}
    />
  );
}

function Inspector({
  id,
  onUnavailable,
}: {
  id: string;
  onUnavailable: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { job, progress, status, streamError, failure, unknown, unavailable } =
    useJobDetail(id, onUnavailable);
  if (unavailable) return null;
  const dateTime = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  return (
    <div className="space-y-4 text-body">
      {job.isPending && !streamError && !failure && (
        <p role="status">{t("jobs.loading")}</p>
      )}
      {job.error && <IpcErrorMessage error={job.error} />}
      {streamError && <IpcErrorMessage error={streamError} />}
      {failure && (
        <p role="alert">{t(`errors.${failure.code}`, failure.params)}</p>
      )}
      {unknown && <p role="alert">{t(unknown)}</p>}
      {job.data && (
        <>
          <h3 className="font-semibold">{t(`jobs.kinds.${job.data.kind}`)}</h3>
          <DictTag
            code="framework.job_status"
            value={status ?? job.data.status}
          />
          <JobProgress
            progress={progress ?? job.data.progress}
            status={status ?? job.data.status}
          />
          <KeyValueList
            items={[
              { key: "id", label: t("jobs.id"), value: id },
              {
                key: "attempts",
                label: t("jobs.attempts"),
                value: `${job.data.attempts} / ${job.data.maxAttempts}`,
              },
              {
                key: "submitter",
                label: t("jobs.submitter"),
                value: t(
                  job.data.submittedBy ? "account.user.owner" : "jobs.system",
                ),
              },
              ...(["createdAt", "startedAt", "finishedAt"] as const).map(
                (key) => {
                  const timestamp = job.data[key];
                  return {
                    key,
                    label: t(`jobs.${key}`),
                    value: timestamp ? (
                      <time dateTime={timestamp}>
                        {dateTime.format(new Date(timestamp))}
                      </time>
                    ) : (
                      "—"
                    ),
                  };
                },
              ),
            ]}
          />
        </>
      )}
    </div>
  );
}
