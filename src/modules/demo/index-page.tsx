import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAuthStatus } from "@/core/auth";
import { DictTag } from "@/core/dict/dict-tag";
import { DataTable, type DataTableColumn, StatCard, StatusPage } from "@/kit";
import type { DemoSample } from "@/lib/generated/DemoSample";
import { overviewQuery } from "./queries";
import { DemoJobs } from "./submitted-jobs";

function Overview({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const overview = useQuery(overviewQuery(userId));
  const columns = useMemo<DataTableColumn<DemoSample>[]>(
    () => [
      {
        id: "code",
        header: t("demo.sample.code"),
        cell: (row) => (
          <Link className="text-brand underline" to={`/demo/samples/${row.id}`}>
            {row.code}
          </Link>
        ),
        rowHeader: true,
      },
      {
        id: "title",
        header: t("demo.sample.title"),
        cell: (row) => row.title,
      },
      {
        id: "stage",
        header: t("demo.sample.stage"),
        cell: (row) => <DictTag code="demo.sample_stage" value={row.stage} />,
      },
      {
        id: "characterCount",
        header: t("demo.sample.characterCount"),
        cell: (row) => row.characterCount ?? "—",
      },
    ],
    [t],
  );
  const stats = overview.data
    ? [
        {
          id: "total",
          title: t("demo.total", { count: overview.data.total }),
          value: overview.data.total,
        },
        {
          id: "ready",
          title: t("demo.ready", { count: overview.data.ready }),
          value: overview.data.ready,
        },
      ]
    : undefined;
  const content = overview.isPending ? (
    <StatusPage kind="loading" />
  ) : overview.isError ? (
    <StatusPage
      kind="error"
      description={t(`errors.${overview.error.code}`, overview.error.params)}
      traceId={overview.error.traceId}
      onRetry={() => void overview.refetch()}
    />
  ) : (
    <DataTable
      caption={t("demo.samples")}
      columns={columns}
      rows={overview.data?.recent}
      getRowId={(row) => row.id}
      refreshing={overview.isFetching}
      emptyView={<StatusPage kind="empty" title={t("demo.empty")} />}
    />
  );
  return (
    <section className="flex flex-col gap-stack p-panel">
      <div className="flex min-w-0 flex-col gap-stack">
        <p className="text-body text-muted-foreground">
          {t("demo.pageDescription")}
        </p>
        {stats && (
          <div className="grid grid-cols-1 gap-stack sm:grid-cols-2 xl:grid-cols-3">
            {stats.map(({ id, ...stat }) => (
              <StatCard key={id} {...stat} />
            ))}
          </div>
        )}
        {content}
      </div>
      <DemoJobs userId={userId} />
    </section>
  );
}

export function DemoIndexPage() {
  const auth = useAuthStatus();
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  return <Overview key={auth.data.user.id} userId={auth.data.user.id} />;
}
