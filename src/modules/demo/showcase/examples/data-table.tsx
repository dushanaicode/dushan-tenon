// showcase-example
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
  EmptyState,
  ErrorView,
  FilterBar,
  FormField,
  Input,
  Pagination,
} from "@/kit";
import { tableRows } from "./filter-bar";
import { RowActions } from "./row-actions";

type Row = (typeof tableRows)[number];
const rowId = (row: Row) => row.id;
const stateKeys = {
  default: "showcase.tables.default",
  empty: "showcase.tables.empty",
  loading: "showcase.tables.loading",
  error: "showcase.tables.error",
} as const;

export function DataTableExample() {
  const { t } = useTranslation();
  const [state, setState] = useState<keyof typeof stateKeys>("default");
  const [sorting, setSorting] = useState<DataTableSortState | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        id: "count",
        header: t("showcase.tables.recordColumn"),
        sortable: true,
        cell: (row) => <RowActions name={t(row.titleKey)} count={row.count} />,
      },
    ],
    [t],
  );
  const matching = tableRows.filter((row) => t(row.titleKey).includes(query));
  const ordered =
    sorting === null
      ? matching
      : [...matching].sort(
          (a, b) => (a.count - b.count) * (sorting.desc ? -1 : 1),
        );
  const rows =
    state === "loading"
      ? undefined
      : state === "empty"
        ? []
        : ordered.slice((page - 1) * 2, page * 2);
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(stateKeys) as (keyof typeof stateKeys)[]).map((value) => (
          <Button
            key={value}
            variant="outline"
            aria-pressed={state === value}
            onClick={() => {
              setState(value);
              setPage(1);
              setSelected(new Set());
            }}
          >
            {t(stateKeys[value])}
          </Button>
        ))}
      </div>
      <FilterBar
        label={t("showcase.tables.filterTable")}
        onSubmit={(values) => {
          setQuery((values.get("name") as string).trim());
          setPage(1);
          setSelected(new Set());
        }}
        onReset={() => {
          setQuery("");
          setPage(1);
          setSelected(new Set());
        }}
      >
        <FormField label={t("showcase.tables.query")}>
          {(control) => <Input {...control} name="name" />}
        </FormField>
      </FilterBar>
      <DataTable
        caption={t("showcase.tables.caption")}
        columns={columns}
        rows={rows}
        getRowId={rowId}
        sorting={{
          value: sorting,
          onChange: (value) => {
            setSorting(value);
            setPage(1);
          },
        }}
        selection={{
          value: selected,
          onChange: setSelected,
          rowLabel: (row) => t(row.titleKey),
        }}
        filtered={query !== ""}
        emptyView={
          <EmptyState
            title={t("showcase.tables.emptyTitle")}
            description={t("showcase.tables.emptyReason")}
            action={
              <Button onClick={() => setState("default")}>
                {t("showcase.tables.restore")}
              </Button>
            }
          />
        }
        noMatchView={
          <EmptyState
            title={t("showcase.tables.noMatch")}
            description={t("showcase.tables.noMatchReason")}
          />
        }
        errorView={
          state === "error" ? (
            <ErrorView
              message={t("showcase.tables.errorReason")}
              onRetry={() => setState("default")}
            />
          ) : undefined
        }
      />
      <p role="status" className="text-sm text-muted-foreground">
        {t("showcase.tables.selectionCount", { count: selected.size })}
      </p>
      <Pagination
        page={page}
        pageSize={2}
        total={state === "empty" ? 0 : matching.length}
        disabled={state !== "default"}
        onPageChange={setPage}
      />
    </div>
  );
}
