import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAuthStatus, usePermission } from "@/core/auth";
import { useDeveloperMode } from "@/core/developer-mode";
import { DictSelect } from "@/core/dict/dict-select";
import { DictTag } from "@/core/dict/dict-tag";
import { ExportButton } from "@/core/exchange/export-button";
import { ImportDialog } from "@/core/exchange/import-dialog";
import { useIncomingFile } from "@/core/file-ingress";
import { IpcErrorMessage } from "@/core/ipc-error";
import { usePageSession } from "@/core/page-session";
import {
  Button,
  type DataTableColumn,
  FormField,
  Input,
  ListPage,
  MasterDetail,
  ScrollArea,
  StatusPage,
} from "@/kit";
import { demoSampleExport, demoSampleImport } from "@/lib/generated/commands";
import type { DemoListInput } from "@/lib/generated/DemoListInput";
import type { DemoSample } from "@/lib/generated/DemoSample";
import type { DemoSampleStage } from "@/lib/generated/DemoSampleStage";
import { demoKey, rememberJob, samplesQuery } from "./queries";
import { SampleDetail } from "./sample-detail";
import { SampleForm } from "./sample-form";
import { DemoJobs } from "./submitted-jobs";
import { useDemoScope } from "./use-demo-scope";

type SampleListView = {
  page: number;
  keyword: string | null;
  stage: DemoSampleStage | null;
  split: boolean;
  selected: string | null;
};

function Samples({ userId }: { userId: string }) {
  const incoming = useIncomingFile("demo.sample-import");
  const { t } = useTranslation();
  const client = useQueryClient();
  const canWrite = usePermission("demo.sample.write");
  const canImport = usePermission("demo.sample.import");
  const canExport = usePermission("demo.sample.export");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isCurrent = useDemoScope(userId);
  const { view, update, restoreScroll } = usePageSession<SampleListView>(
    userId,
    "demo.samples",
    {
      page: 1,
      keyword: null,
      stage: null,
      split: false,
      selected: null,
    },
    scrollRef,
  );
  const input: DemoListInput = {
    page: view.page,
    pageSize: 20,
    keyword: view.keyword ?? undefined,
    stage: view.stage ?? undefined,
  };
  const [stage, setStage] = useState<DemoSampleStage | "">(view.stage ?? "");
  const [creating, setCreating] = useState(false);
  const { split, selected } = view;
  const query = useQuery(samplesQuery(userId, input));
  useLayoutEffect(
    () => (query.isSuccess ? restoreScroll() : undefined),
    [query.isSuccess, restoreScroll],
  );
  const columnLabel = useCallback(
    (column: string) => t(`demo.sample.${column}`),
    [t],
  );
  const refresh = () => {
    if (!isCurrent()) return;
    void client.invalidateQueries({ queryKey: demoKey(userId) });
  };
  const columns = useMemo<DataTableColumn<DemoSample>[]>(
    () => [
      {
        id: "code",
        header: t("demo.sample.code"),
        rowHeader: true,
        cell: (sample) => (
          <Link
            className="text-brand underline"
            to={`/demo/samples/${sample.id}`}
            aria-current={selected === sample.id ? "true" : undefined}
            onClick={(event) => {
              if (
                split &&
                window.matchMedia("(min-width: 768px)").matches &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                update({ selected: sample.id });
              }
            }}
          >
            {sample.code}
          </Link>
        ),
      },
      {
        id: "title",
        header: t("demo.sample.title"),
        cell: (sample) => sample.title,
      },
      {
        id: "stage",
        header: t("demo.sample.stage"),
        cell: (sample) => (
          <DictTag code="demo.sample_stage" value={sample.stage} />
        ),
      },
    ],
    [t, split, selected, update],
  );
  const list = (
    <ListPage
      title={t("demo.sampleList")}
      description={t("demo.listHint")}
      actions={
        <>
          <Button
            className="hidden md:inline-flex"
            variant="outline"
            aria-pressed={split}
            onClick={() => update({ split: !split })}
          >
            {t("demo.masterDetail")}
          </Button>
          {canWrite && (
            <Button onClick={() => setCreating(true)}>
              {t("demo.create")}
            </Button>
          )}
        </>
      }
      filters={{
        label: t("demo.filter"),
        pending: query.isFetching,
        onSubmit: (data) => {
          update(
            {
              page: 1,
              keyword: String(data.get("keyword")),
              stage: stage || null,
              selected: null,
            },
            true,
          );
        },
        onReset: () => {
          setStage("");
          update({ page: 1, keyword: null, stage: null, selected: null }, true);
        },
        children: (
          <>
            <FormField label={t("demo.keyword")}>
              {(control) => (
                <Input
                  {...control}
                  name="keyword"
                  defaultValue={input.keyword ?? ""}
                />
              )}
            </FormField>
            <FormField label={t("demo.sample.stage")}>
              {(control) => (
                <DictSelect
                  {...control}
                  code="demo.sample_stage"
                  value={stage}
                  onValueChange={setStage}
                  emptyLabel={t("demo.allStages")}
                />
              )}
            </FormField>
          </>
        ),
      }}
      table={{
        caption: t("demo.sampleList"),
        columns,
        rows: query.data?.items,
        getRowId: (row) => row.id,
        refreshing: query.isFetching,
        filtered: Boolean(input.keyword || input.stage),
        errorView: query.error ? (
          <IpcErrorMessage error={query.error} />
        ) : undefined,
        emptyView: <StatusPage kind="empty" title={t("demo.empty")} />,
        noMatchView: <StatusPage kind="empty" title={t("demo.noMatch")} />,
      }}
      pagination={
        query.data
          ? {
              page: input.page,
              pageSize: input.pageSize,
              total: query.data.total,
              disabled: query.isFetching,
              onPageChange: (page) => {
                update({ page, selected: null }, true);
              },
            }
          : undefined
      }
    />
  );
  return (
    <ScrollArea
      ref={scrollRef}
      role="region"
      region="content"
      aria-label={t("demo.sampleList")}
      className="h-full min-h-0"
      plateClassName="flex flex-col gap-stack p-panel"
    >
      {split ? (
        <MasterDetail
          className="@medium/content:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
          master={
            <div className="@medium/content:pr-[var(--panel-pad)]">{list}</div>
          }
          masterLabel={t("demo.sampleList")}
          detailLabel={t("demo.detail")}
          detail={
            selected ? (
              <SampleDetail
                key={selected}
                userId={userId}
                id={selected}
                onDeleted={() => update({ selected: null })}
              />
            ) : (
              <StatusPage kind="empty" title={t("demo.selectSample")} />
            )
          }
        />
      ) : (
        list
      )}
      <section
        aria-label={t("demo.exchange")}
        className="flex flex-col gap-stack"
      >
        <p className="text-body">{t("demo.importRules")}</p>
        {canExport && (
          <ExportButton
            suggestedName="demo-samples"
            onComplete={refresh}
            onSubmit={async (format, fileToken) => {
              if (!isCurrent())
                throw new Error("Demo page is no longer active");
              const submitted = await demoSampleExport({
                format,
                fileToken,
                keyword: input.keyword,
                stage: input.stage,
              });
              if (isCurrent()) rememberJob(client, userId, submitted);
              return submitted;
            }}
          />
        )}
        {canWrite && canImport && (
          <div>
            <ImportDialog
              pickedFile={incoming?.file}
              onPickedConsumed={incoming?.clear}
              modes={["error", "skip"]}
              suggestedName="demo-samples"
              columnLabel={columnLabel}
              onComplete={refresh}
              onSubmit={async (fileToken, mode) => {
                if (!isCurrent())
                  throw new Error("Demo page is no longer active");
                if (mode !== "error" && mode !== "skip")
                  throw new Error(`Invalid demo import mode: ${mode}`);
                const submitted = await demoSampleImport({ fileToken, mode });
                if (isCurrent()) rememberJob(client, userId, submitted);
                return submitted;
              }}
            />
          </div>
        )}
      </section>
      <DemoJobs userId={userId} />
      {creating && canWrite && (
        <SampleForm userId={userId} onClose={() => setCreating(false)} />
      )}
    </ScrollArea>
  );
}

export default function DemoSamplesPage() {
  const auth = useAuthStatus();
  const developerMode = useDeveloperMode();
  const canRead = usePermission("demo.sample.read");
  if (!developerMode) return <StatusPage kind="notFound" />;
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  if (!canRead) return <StatusPage kind="forbidden" />;
  return (
    <Samples
      key={`${auth.data.user.id}:${auth.data.permissions.join(",")}`}
      userId={auth.data.user.id}
    />
  );
}
