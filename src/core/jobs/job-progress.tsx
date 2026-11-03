import { useTranslation } from "react-i18next";
import type { JobProgress as Progress } from "@/lib/generated/JobProgress";
import type { JobStatus } from "@/lib/generated/JobStatus";

export function JobProgress({
  progress,
  status,
}: {
  progress: Progress;
  status: JobStatus;
}) {
  const { t } = useTranslation();
  const active = status === "queued" || status === "running";
  if (!active && (progress.total === null || progress.total <= 0)) return null;
  if (progress.total === null || progress.total <= 0)
    return (
      <p
        data-slot="job-progress"
        data-part="description"
        className="text-sm text-muted-foreground"
      >
        {t("jobs.noProgress")}
      </p>
    );
  return (
    <div data-slot="job-progress" className="space-y-1">
      <progress
        data-part="indicator"
        className="h-2 w-full"
        aria-label={t("jobs.progressLabel")}
        value={progress.current ?? undefined}
        max={progress.total}
      />
      <p data-part="value" className="text-sm text-muted-foreground">
        {progress.current !== null
          ? t("jobs.progressCount", {
              current: progress.current,
              total: progress.total,
            })
          : t("jobs.noProgress")}
      </p>
      {active && progress.messageKey && (
        <p data-part="description">{t(progress.messageKey, progress.params)}</p>
      )}
    </div>
  );
}
