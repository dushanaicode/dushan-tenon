import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
  EmptyState,
  ErrorView,
} from "@/kit";
import catalog from "../catalog/tables.json";
import { DataTableExample } from "../examples/data-table";
import { FilterBarExample } from "../examples/filter-bar";
import { RowActionsExample } from "../examples/row-actions";
import { ShowcasePage } from "../showcase-page";

export const tablesExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/data-table.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/row-actions.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/filter-bar.tsx?raw")
      : undefined,
  },
];
const states = [
  { id: "default", key: "showcase.tables.default" },
  { id: "empty", key: "showcase.tables.empty" },
  { id: "loading", key: "showcase.tables.loading" },
  { id: "error", key: "showcase.tables.error" },
  { id: "selected", key: "showcase.tables.selected" },
  { id: "sorted", key: "showcase.tables.sorted" },
];
function TableState({ state }: { state: (typeof states)[number] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(["sample"]),
  );
  const [sorting, setSorting] = useState<DataTableSortState | null>({
    id: "name",
    desc: false,
  });
  const columns = useMemo<DataTableColumn<string>[]>(
    () => [
      {
        id: "name",
        header: t("showcase.tables.query"),
        cell: () => t("showcase.tables.sampleA"),
        sortable: state.id === "sorted",
      },
    ],
    [t, state.id],
  );
  return (
    <DataTable
      caption={t(state.key)}
      columns={columns}
      rows={
        state.id === "loading"
          ? undefined
          : state.id === "empty"
            ? []
            : ["sample"]
      }
      getRowId={(row) => row}
      skeletonRows={1}
      emptyView={
        <EmptyState
          title={t("showcase.tables.emptyTitle")}
          description={t("showcase.tables.emptyReason")}
        />
      }
      errorView={
        state.id === "error" ? (
          <ErrorView message={t("showcase.tables.errorReason")} />
        ) : undefined
      }
      selection={
        state.id === "selected"
          ? {
              value: selected,
              onChange: setSelected,
              rowLabel: () => t("showcase.tables.sampleA"),
            }
          : undefined
      }
      sorting={
        state.id === "sorted"
          ? { value: sorting, onChange: setSorting }
          : undefined
      }
    />
  );
}
export function TablesPage() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<(typeof states)[number]>[]>(
    () => [
      {
        id: "state",
        header: t("showcase.tables.state"),
        rowHeader: true,
        cell: (row) => t(row.key),
      },
      {
        id: "table",
        header: t("showcase.tables.actualState"),
        cell: (row) => <TableState state={row} />,
        className: "min-w-80 whitespace-normal",
      },
    ],
    [t],
  );
  return (
    <ShowcasePage
      id="tables"
      entries={catalog}
      examples={tablesExamples}
      matrix={
        <DataTable
          caption={t("showcase.tables.matrixCaption")}
          columns={columns}
          rows={states}
          getRowId={(row) => row.id}
        />
      }
      preview={
        <div className="min-w-0 space-y-6">
          <p className="text-sm text-muted-foreground">
            {t("showcase.tables.contract")}
          </p>
          <DataTableExample />
          <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.tables.actionsHeading")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("showcase.tables.visibleEntry")}
              </p>
              <RowActionsExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.tables.filterHeading")}
              </h3>
              <FilterBarExample />
            </section>
          </div>
        </div>
      }
    />
  );
}
