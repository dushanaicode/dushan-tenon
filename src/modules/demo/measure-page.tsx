import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useAuthStatus, usePermission } from "@/core/auth";
import { useDeveloperMode } from "@/core/developer-mode";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  DataTable,
  type DataTableColumn,
  Pagination,
  StatusPage,
  WizardPage,
} from "@/kit";
import { demoMeasureStart } from "@/lib/generated/commands";
import type { DemoSample } from "@/lib/generated/DemoSample";
import type { DemoSampleVersion } from "@/lib/generated/DemoSampleVersion";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobSubmitted } from "@/lib/generated/JobSubmitted";
import { rememberJob, samplesQuery } from "./queries";
import { DemoJobs } from "./submitted-jobs";
import { useDemoScope } from "./use-demo-scope";

type Selection = DemoSampleVersion & { code: string };

function Measure({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlyMap<string, Selection>>(
    new Map(),
  );
  const submitting = useRef(false);
  const isCurrent = useDemoScope(userId);
  const query = useQuery(samplesQuery(userId, { page, pageSize: 20 }));
  const submit = useMutation<JobSubmitted, IpcError, DemoSampleVersion[]>({
    mutationFn: (samples) => demoMeasureStart({ samples }),
    onSuccess: (result) => {
      if (!isCurrent()) return;
      rememberJob(client, userId, result);
      navigate(`/demo/jobs/${result.jobId}`);
    },
    onError: () => {
      submitting.current = false;
    },
    retry: false,
    gcTime: 0,
  });
  const columns = useMemo<DataTableColumn<DemoSample>[]>(
    () => [
      {
        id: "code",
        header: t("demo.sample.code"),
        cell: (row) => row.code,
        rowHeader: true,
      },
      { id: "title", header: t("demo.sample.title"), cell: (row) => row.title },
      {
        id: "version",
        header: t("demo.version"),
        cell: (row) => row.rowVersion,
      },
    ],
    [t],
  );
  const reviewColumns = useMemo<DataTableColumn<Selection>[]>(
    () => [
      {
        id: "code",
        header: t("demo.sample.code"),
        cell: (row) => row.code,
        rowHeader: true,
      },
      {
        id: "version",
        header: t("demo.version"),
        cell: (row) => row.rowVersion,
      },
    ],
    [t],
  );
  return (
    <div className="flex flex-col gap-stack p-panel">
      <WizardPage
        title={t("demo.measure")}
        label={t("demo.measure")}
        description={t("demo.measureHint")}
        current={step}
        onCurrentChange={(next) => {
          if (!submitting.current) setStep(next);
        }}
        canProceed={
          selected.size > 0 &&
          selected.size <= 1000 &&
          !submit.isPending &&
          (step === 1 || query.isSuccess)
        }
        pending={submit.isPending}
        finishLabel={t("demo.submitMeasure")}
        onFinish={() => {
          if (submitting.current) return;
          submitting.current = true;
          submit.mutate(
            [...selected.values()].map(({ id, rowVersion }) => ({
              id,
              rowVersion,
            })),
          );
        }}
        steps={[
          {
            id: "select",
            label: t("demo.selectSamples"),
            content: (
              <>
                <DataTable
                  caption={t("demo.selectSamples")}
                  columns={columns}
                  rows={query.data?.items}
                  getRowId={(row) => row.id}
                  refreshing={query.isFetching}
                  errorView={
                    query.error ? (
                      <IpcErrorMessage error={query.error} />
                    ) : undefined
                  }
                  emptyView={
                    <StatusPage kind="empty" title={t("demo.empty")} />
                  }
                  selection={{
                    value: new Set(selected.keys()),
                    rowLabel: (row) => row.code,
                    onChange: (ids) => {
                      const next = new Map(selected);
                      for (const id of next.keys())
                        if (!ids.has(id)) next.delete(id);
                      for (const row of query.data?.items ?? []) {
                        if (ids.has(row.id) && !next.has(row.id))
                          next.set(row.id, {
                            id: row.id,
                            rowVersion: row.rowVersion,
                            code: row.code,
                          });
                      }
                      setSelected(next);
                    },
                  }}
                />
                {query.data && (
                  <Pagination
                    page={page}
                    pageSize={20}
                    total={query.data.total}
                    onPageChange={setPage}
                    disabled={query.isFetching}
                  />
                )}
              </>
            ),
          },
          {
            id: "review",
            label: t("demo.review"),
            content: (
              <>
                <p className="text-body">{t("demo.reviewHint")}</p>
                <DataTable
                  caption={t("demo.review")}
                  columns={reviewColumns}
                  rows={[...selected.values()]}
                  getRowId={(row) => row.id}
                />
              </>
            ),
          },
        ]}
      />
      <p role="status" className="text-body">
        {t("demo.selectedCount", { count: selected.size })}
      </p>
      {selected.size > 1000 && <p role="alert">{t("demo.selectionLimit")}</p>}
      {submit.error && <IpcErrorMessage error={submit.error} />}
      <DemoJobs userId={userId} />
    </div>
  );
}

export default function DemoMeasurePage() {
  const auth = useAuthStatus();
  const developerMode = useDeveloperMode();
  const canRead = usePermission("demo.sample.read");
  const canRun = usePermission("demo.sample.run");
  if (!developerMode) return <StatusPage kind="notFound" />;
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  if (!canRead || !canRun) return <StatusPage kind="forbidden" />;
  return (
    <Measure
      key={`${auth.data.user.id}:${auth.data.permissions.join(",")}`}
      userId={auth.data.user.id}
    />
  );
}
