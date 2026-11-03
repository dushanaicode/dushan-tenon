import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { usePermission } from "@/core/auth";
import { DictTag } from "@/core/dict/dict-tag";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ErrorView,
  PageHeader,
} from "@/kit";
import {
  devtoolsScheduleList,
  devtoolsScheduleRunNow,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobSubmitted } from "@/lib/generated/JobSubmitted";
import type { ScheduleSnapshot } from "@/lib/generated/ScheduleSnapshot";

const schedulesKey = ["devtools", "schedules"];

export function SchedulesPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const writable = usePermission("devtools.job.write");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const schedules = useQuery<ScheduleSnapshot[], IpcError>({
    queryKey: schedulesKey,
    queryFn: devtoolsScheduleList,
    refetchInterval: 5000,
  });
  const mutation = useMutation<JobSubmitted, IpcError, string>({
    mutationFn: (id) => devtoolsScheduleRunNow({ id }),
    onSuccess: async (result) => {
      setSubmitted(result.jobId);
      await client.invalidateQueries({ queryKey: schedulesKey });
    },
    onError: async (error) => {
      if (
        error.code === "app.data.not_found" ||
        error.code === "devtools.schedule.undeclared"
      ) {
        await client.invalidateQueries({ queryKey: schedulesKey });
      }
    },
  });
  const columns = useMemo<DataTableColumn<ScheduleSnapshot>[]>(() => {
    const dateTime = (time: string, timezone?: string) =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: timezone,
      }).format(new Date(time));
    return [
      {
        id: "name",
        header: t("schedules.name"),
        rowHeader: true,
        cell: (schedule) => (
          <>
            <span>
              {t(`schedules.keys.${schedule.key}`, {
                defaultValue: schedule.key,
              })}
            </span>
            <p className="mt-1 font-normal text-muted-foreground">
              {t(`jobs.kinds.${schedule.kind}`, {
                defaultValue: schedule.kind,
              })}
            </p>
            {!schedule.declared && (
              <span className="mt-1 inline-block rounded bg-muted px-2 py-1 text-xs">
                {t("schedules.undeclared")}
              </span>
            )}
          </>
        ),
      },
      {
        id: "cron",
        header: t("schedules.cron"),
        className: "whitespace-nowrap font-mono",
        cell: (schedule) => schedule.cron,
      },
      {
        id: "timezone",
        header: t("schedules.timezone"),
        cell: (schedule) => schedule.timezone,
      },
      {
        id: "enabled",
        header: t("schedules.enabled"),
        cell: (schedule) =>
          t(schedule.enabled ? "schedules.on" : "schedules.off"),
      },
      {
        id: "nextRunAt",
        header: t("schedules.nextRunAt"),
        className: "min-w-48",
        cell: (schedule) =>
          schedule.nextRunAt ? (
            <>
              <time dateTime={schedule.nextRunAt}>
                {dateTime(schedule.nextRunAt, schedule.timezone)}
              </time>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("schedules.localTime", {
                  time: dateTime(schedule.nextRunAt),
                })}
              </p>
            </>
          ) : (
            "—"
          ),
      },
      {
        id: "lastRunAt",
        header: t("schedules.lastRunAt"),
        className: "min-w-44",
        cell: (schedule) => (
          <>
            {schedule.lastRunAt ? (
              <time dateTime={schedule.lastRunAt}>
                {dateTime(schedule.lastRunAt, schedule.timezone)}
              </time>
            ) : (
              "—"
            )}
            {schedule.lastJobId && (
              <Link
                className="mt-1 block text-brand underline"
                to={`/devtools/jobs/${schedule.lastJobId}`}
              >
                {schedule.lastJobStatus ? (
                  <DictTag
                    code="framework.job_status"
                    value={schedule.lastJobStatus}
                  />
                ) : (
                  t("schedules.viewJob")
                )}
              </Link>
            )}
          </>
        ),
      },
      {
        id: "actions",
        header: t("schedules.actions"),
        cell: (schedule) =>
          writable &&
          schedule.declared && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(schedule.id)}
              >
                {t("schedules.runNow")}
              </Button>
            </div>
          ),
      },
    ];
  }, [i18n.resolvedLanguage, mutation.isPending, mutation.mutate, t, writable]);
  return (
    <section className="mx-auto max-w-7xl space-y-6 py-10">
      <PageHeader title={t("schedules.title")} />
      {mutation.isError && <IpcErrorMessage error={mutation.error} />}
      {submitted && (
        <p role="status">
          {t("schedules.submitted")}{" "}
          <Link
            className="text-primary underline"
            to={`/devtools/jobs/${submitted}`}
          >
            {t("schedules.viewJob")}
          </Link>
        </p>
      )}
      <DataTable
        caption={t("schedules.title")}
        columns={columns}
        rows={schedules.data}
        getRowId={(schedule) => schedule.id}
        refreshing={schedules.isFetching}
        emptyView={<EmptyState title={t("schedules.empty")} />}
        errorView={
          schedules.isError ? (
            <ErrorView
              message={t(
                `errors.${schedules.error.code}`,
                schedules.error.params,
              )}
              detail={t("error.traceId", { traceId: schedules.error.traceId })}
              onRetry={() => void schedules.refetch()}
              retrying={schedules.isFetching}
            />
          ) : undefined
        }
      />
    </section>
  );
}
