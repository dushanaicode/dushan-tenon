import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DictSelect } from "@/core/dict/dict-select";
import { DictTag } from "@/core/dict/dict-tag";
import { JobProgress } from "@/core/jobs/job-progress";
import {
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ErrorView,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/kit";
import { devtoolsJobList } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobStatus } from "@/lib/generated/JobStatus";
import type { JobSummary } from "@/lib/generated/JobSummary";
import { JOB_KINDS } from "@/lib/generated/job-kinds";
import type { Page } from "@/lib/generated/Page";

const pageSize = 20;
// 零任务种类时 JOB_KINDS 是空元组、JobKind 为 never，迭代需显式宽类型。
const jobKinds: readonly string[] = JOB_KINDS;

export function JobsPage() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<JobStatus>();
  const [kind, setKind] = useState<string>();
  const jobs = useQuery<Page<JobSummary>, IpcError>({
    queryKey: ["devtools", "jobs", page, status, kind],
    queryFn: () => devtoolsJobList({ page, pageSize, status, kind }),
    refetchInterval: 5000,
  });
  const columns = useMemo<DataTableColumn<JobSummary>[]>(() => {
    const dateTime = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    return [
      {
        id: "kind",
        header: t("jobs.kind"),
        rowHeader: true,
        cell: (job) => (
          <Link
            className="text-brand underline"
            to={`/devtools/jobs/${job.id}`}
          >
            {t(`jobs.kinds.${job.kind}`)}
          </Link>
        ),
      },
      {
        id: "status",
        header: t("jobs.status"),
        cell: (job) => (
          <DictTag code="framework.job_status" value={job.status} />
        ),
      },
      {
        id: "progressLabel",
        header: t("jobs.progressLabel"),
        className: "min-w-40",
        cell: (job) => (
          <JobProgress progress={job.progress} status={job.status} />
        ),
      },
      {
        id: "submitter",
        header: t("jobs.submitter"),
        cell: (job) =>
          job.submittedBy ? t("account.user.owner") : t("jobs.system"),
      },
      {
        id: "createdAt",
        header: t("jobs.createdAt"),
        className: "whitespace-nowrap",
        cell: (job) => (
          <time dateTime={job.createdAt}>
            {dateTime.format(new Date(job.createdAt))}
          </time>
        ),
      },
    ];
  }, [i18n.resolvedLanguage, t]);
  return (
    <section className="mx-auto max-w-6xl space-y-6 py-10">
      <PageHeader title={t("jobs.title")} />
      <div className="flex flex-wrap gap-4">
        <label htmlFor="job-status" className="space-y-2">
          <span className="block">{t("jobs.status")}</span>
          <DictSelect
            id="job-status"
            code="framework.job_status"
            emptyLabel={t("jobs.all")}
            value={status ?? ""}
            onValueChange={(value: JobStatus | "") => {
              setStatus(value || undefined);
              setPage(1);
            }}
          />
        </label>
        <label htmlFor="job-kind" className="space-y-2">
          <span className="block">{t("jobs.kind")}</span>
          <Select
            value={kind ?? ""}
            onValueChange={(value) => {
              setKind(value === "__all__" ? undefined : value);
              setPage(1);
            }}
          >
            <SelectTrigger id="job-kind" aria-label={t("jobs.kind")}>
              <SelectValue placeholder={t("jobs.all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("jobs.all")}</SelectItem>
              {jobKinds.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`jobs.kinds.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <DataTable
        caption={t("jobs.title")}
        columns={columns}
        rows={jobs.data?.items}
        getRowId={(job) => job.id}
        refreshing={jobs.isFetching}
        emptyView={<EmptyState title={t("jobs.empty")} />}
        filtered={status !== undefined || kind !== undefined}
        noMatchView={
          <EmptyState
            title={t("jobs.empty")}
            description={t("kit.table.noMatch")}
          />
        }
        errorView={
          jobs.isError ? (
            <ErrorView
              message={t(`errors.${jobs.error.code}`, jobs.error.params)}
              detail={t("error.traceId", { traceId: jobs.error.traceId })}
              onRetry={() => void jobs.refetch()}
              retrying={jobs.isFetching}
            />
          ) : undefined
        }
      />
      {jobs.data && (
        <nav
          aria-label={t("jobs.pagination")}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p>
            {t("jobs.pageInfo", {
              page,
              pages: Math.max(1, Math.ceil(jobs.data.total / pageSize)),
              total: jobs.data.total,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={page === 1 || jobs.isFetching}
              onClick={() => setPage(page - 1)}
            >
              {t("jobs.previous")}
            </Button>
            <Button
              variant="ghost"
              disabled={page * pageSize >= jobs.data.total || jobs.isFetching}
              onClick={() => setPage(page + 1)}
            >
              {t("jobs.next")}
            </Button>
          </div>
        </nav>
      )}
    </section>
  );
}
