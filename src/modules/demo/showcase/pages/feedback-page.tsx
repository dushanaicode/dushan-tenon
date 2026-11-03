import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ErrorView,
  Progress,
  Spinner,
} from "@/kit";
import catalog from "../catalog/feedback.json";
import { AlertExample } from "../examples/alert";
import { EmptyStateExample } from "../examples/empty-state";
import { ErrorViewExample } from "../examples/error-view";
import { LoadingExample } from "../examples/loading";
import { LoadingStylesExample } from "../examples/loading-styles";
import { ProgressExample } from "../examples/progress";
import { ToastExample } from "../examples/toast";
import { ShowcasePage } from "../showcase-page";

export const feedbackExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/toast.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/alert.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/progress.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/loading.tsx?raw")
      : undefined,
  },
  {
    file: catalog[4].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/empty-state.tsx?raw")
      : undefined,
  },
  {
    file: catalog[5].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/error-view.tsx?raw")
      : undefined,
  },
  {
    file: catalog[6].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/loading-styles.tsx?raw")
      : undefined,
  },
];

export function FeedbackPage() {
  const { t } = useTranslation();
  const rows = [
    {
      id: "running",
      label: t("showcase.feedback.inProgress"),
      component: "Spinner / Skeleton",
      view: (
        <div role="status" className="flex items-center gap-2">
          <Spinner aria-hidden="true" />
          {t("showcase.feedback.loading")}
        </div>
      ),
    },
    {
      id: "done",
      label: t("showcase.feedback.success"),
      component: "Alert / toast",
      view: (
        <Alert tone="success">{t("showcase.feedback.successReason")}</Alert>
      ),
    },
    {
      id: "empty",
      label: t("showcase.feedback.empty"),
      component: "EmptyState",
      view: (
        <EmptyState
          title={t("showcase.feedback.emptyTitle")}
          description={t("showcase.feedback.emptyReason")}
        />
      ),
    },
    {
      id: "failed",
      label: t("showcase.feedback.danger"),
      component: "ErrorView",
      view: <ErrorView message={t("showcase.feedback.errorReason")} />,
    },
    {
      id: "unknown",
      label: t("showcase.feedback.unknown"),
      component: "Progress",
      view: (
        <div className="space-y-2">
          <p>{t("showcase.feedback.unknownProgress")}</p>
          <Progress
            value={null}
            aria-label={t("showcase.feedback.unknownProgress")}
          />
        </div>
      ),
    },
  ];
  const columns = useMemo<DataTableColumn<(typeof rows)[number]>[]>(
    () => [
      {
        id: "state",
        header: t("showcase.feedback.state"),
        rowHeader: true,
        cell: (row) => row.label,
      },
      {
        id: "component",
        header: t("showcase.feedback.component"),
        cell: (row) => row.component,
      },
      {
        id: "view",
        header: t("showcase.feedback.actualState"),
        cell: (row) => row.view,
        className: "min-w-64 whitespace-normal",
      },
    ],
    [t],
  );
  return (
    <ShowcasePage
      id="feedback"
      entries={catalog}
      examples={feedbackExamples}
      matrix={
        <DataTable
          caption={t("showcase.feedback.matrixCaption")}
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
        />
      }
      preview={
        <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
          <section className="min-w-0 space-y-4">
            <h3 className="font-semibold">
              {t("showcase.feedback.noticeHeading")}
            </h3>
            <ToastExample />
            <AlertExample />
          </section>
          <section className="min-w-0 space-y-4">
            <h3 className="font-semibold">
              {t("showcase.feedback.processHeading")}
            </h3>
            <ProgressExample />
            <LoadingExample />
          </section>
          <section className="min-w-0 space-y-3 @3xl:col-span-2">
            <h3 className="font-semibold">{t("showcase.readings.loading")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("showcase.feedback.loadingStylesDescription")}
            </p>
            <LoadingStylesExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">
              {t("showcase.feedback.emptyHeading")}
            </h3>
            <EmptyStateExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">
              {t("showcase.feedback.errorHeading")}
            </h3>
            <ErrorViewExample />
          </section>
        </div>
      }
    />
  );
}
