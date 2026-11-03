import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/kit";
import catalog from "../catalog/display.json";
import { KeyValueListExample } from "../examples/key-value-list";
import { StatCardExample } from "../examples/stat-card";
import { StatusBadgeExample } from "../examples/status-badge";
import { TimelineExample } from "../examples/timeline";
import { VirtualLogExample } from "../examples/virtual-log";
import { ShowcasePage } from "../showcase-page";

export const displayExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/timeline.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/key-value-list.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/stat-card.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/status-badge.tsx?raw")
      : undefined,
  },
  {
    file: "src/modules/demo/showcase/examples/virtual-log.tsx",
    load: import.meta.env.DEV
      ? () => import("../examples/virtual-log.tsx?raw")
      : undefined,
  },
];
export function DisplayPage() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<(typeof catalog)[number]>[]>(
    () => [
      {
        id: "type",
        header: t("showcase.display.component"),
        rowHeader: true,
        cell: (row) => t(row.titleKey),
      },
      {
        id: "shape",
        header: t("showcase.display.shape"),
        cell: (row) => t(row.whenToUseKey),
        className: "min-w-64 whitespace-normal",
      },
      {
        id: "boundary",
        header: t("showcase.display.boundary"),
        cell: (row) => t(row.notForKey),
        className: "min-w-64 whitespace-normal",
      },
    ],
    [t],
  );
  return (
    <ShowcasePage
      id="display"
      entries={catalog}
      examples={displayExamples}
      matrix={
        <DataTable
          caption={t("showcase.display.matrixCaption")}
          columns={columns}
          rows={catalog}
          getRowId={(row) => row.id}
        />
      }
      preview={
        <>
          <p className="text-sm text-muted-foreground">
            {t("showcase.display.sameRecord")}
          </p>
          <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.display.timelineHeading")}
              </h3>
              <TimelineExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.display.detailsHeading")}
              </h3>
              <KeyValueListExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.display.statsHeading")}
              </h3>
              <StatCardExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.display.listHeading")}
              </h3>
              <StatusBadgeExample />
            </section>
          </div>
          <VirtualLogExample />
        </>
      }
    />
  );
}
