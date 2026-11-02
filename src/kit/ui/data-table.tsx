// Built on TanStack Table v9 (MIT); markup adapted from shadcn/ui's Table (shadcn-ui/ui d2fba50); semantic kit tokens.
import {
  createColumnHelper,
  functionalUpdate,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { EmptyState } from "./empty-state";
import { ScrollArea } from "./scroll-area";
import { Skeleton } from "./skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  rowHeader?: boolean;
  sortable?: boolean;
  align?: "start" | "end";
  className?: string;
};

export type DataTableSortState = { id: string; desc: boolean };

export type DataTableSorting = {
  value: DataTableSortState | null;
  onChange: (next: DataTableSortState | null) => void;
};

export type DataTableSelection<T> = {
  value: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  rowLabel: (row: T) => string;
};

export type DataTableProps<T> = {
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[] | undefined;
  getRowId: (row: T) => string;
  refreshing?: boolean;
  errorView?: ReactNode;
  filtered?: boolean;
  emptyView?: ReactNode;
  noMatchView?: ReactNode;
  sorting?: DataTableSorting;
  selection?: DataTableSelection<T>;
  skeletonRows?: number;
  className?: string;
};

const features = tableFeatures({ rowSelectionFeature, rowSortingFeature });
const EMPTY_ROWS: readonly never[] = [];

function TableSkeleton({
  columns,
  count,
  selectable,
}: {
  columns: readonly { id: string }[];
  count: number;
  selectable: boolean;
}) {
  return Array.from({ length: count }, (_, index) => `skeleton-${index}`).map(
    (id) => (
      <TableRow key={id} aria-hidden="true">
        {selectable && (
          <TableCell>
            <Skeleton className="size-4" />
          </TableCell>
        )}
        {columns.map((column) => (
          <TableCell key={column.id}>
            <Skeleton className="h-4 w-3/4" />
          </TableCell>
        ))}
      </TableRow>
    ),
  );
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  refreshing = false,
  errorView,
  filtered,
  emptyView,
  noMatchView,
  sorting,
  selection,
  skeletonRows = 5,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  // v9 accepts object rows; keep the public, unconstrained T contract intact.
  const data = useMemo(
    () => (rows === undefined ? EMPTY_ROWS : rows.map((value) => ({ value }))),
    [rows],
  );
  const definitions = useMemo(() => {
    const helper = createColumnHelper<typeof features, { value: T }>();
    return columns.map((column) =>
      // v9 requires an accessor for getCanSort, even with manual sorting.
      helper.accessor((row: { value: T }): unknown => row.value, {
        id: column.id,
        header: () => column.header,
        cell: ({ row }) => column.cell(row.original.value),
        enableSorting: column.sortable === true,
      }),
    );
  }, [columns]);
  const sortValue = sorting?.value;
  const sortState = useMemo(() => (sortValue ? [sortValue] : []), [sortValue]);
  const selectedIds = selection?.value;
  const rowSelection = useMemo(
    () =>
      selectedIds
        ? Object.fromEntries(
            Array.from(selectedIds, (id) => [id, true as const]),
          )
        : {},
    [selectedIds],
  );
  const table = useTable({
    features,
    data,
    columns: definitions,
    getRowId: (row) => getRowId(row.value),
    manualSorting: true,
    enableSorting: sorting !== undefined,
    enableMultiSort: false,
    sortDescFirst: false,
    enableRowSelection: selection !== undefined,
    state: { sorting: sortState, rowSelection },
    onSortingChange: sorting
      ? (updater) => {
          const next = functionalUpdate(updater, sortState);
          sorting.onChange(next[0] ?? null);
        }
      : undefined,
    onRowSelectionChange: selection
      ? (updater) => {
          const next = functionalUpdate(updater, rowSelection);
          selection.onChange(new Set(Object.keys(next)));
        }
      : undefined,
  });
  const loading = rows === undefined && errorView == null;
  const stale = rows !== undefined && refreshing;
  const columnCount = columns.length + (selection ? 1 : 0);
  const wasLoading = useRef(false);
  const phase = useRef<"pending" | "revealing" | "done">("pending");
  const firstRowIds = useRef<ReadonlySet<string> | null>(null);

  if (loading) wasLoading.current = true;
  if (phase.current === "pending" && rows !== undefined) {
    if (!wasLoading.current) {
      phase.current = "done";
    } else if (errorView == null && rows.length > 0) {
      firstRowIds.current = new Set(rows.map(getRowId));
      phase.current = "revealing";
    }
  }
  if (phase.current === "revealing") {
    const firstIds = firstRowIds.current as ReadonlySet<string>;
    if (
      rows === undefined ||
      errorView != null ||
      rows.length !== firstIds.size ||
      !rows.every((row) => firstIds.has(getRowId(row)))
    ) {
      phase.current = "done";
    }
  }

  return (
    <div
      data-slot="table-container"
      className={cn(
        "relative w-full rounded-lg border border-border",
        className,
      )}
    >
      <ScrollArea
        role="region"
        axis="x"
        data-part="table-scroll"
        aria-label={caption}
        tabIndex={0}
        aria-busy={loading || refreshing}
        data-refreshing={stale || undefined}
        className="rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {selection && (
                  <TableHead className="w-12">
                    <Checkbox
                      aria-label={t("kit.table.selectAll")}
                      disabled={
                        errorView != null ||
                        table.getRowModel().rows.length === 0
                      }
                      checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && "indeterminate")
                      }
                      onCheckedChange={(checked) =>
                        table.toggleAllPageRowsSelected(checked === true)
                      }
                    />
                  </TableHead>
                )}
                {group.headers.map((header, index) => {
                  const column = columns[index];
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const SortIcon =
                    sorted === "asc"
                      ? ArrowUp
                      : sorted === "desc"
                        ? ArrowDown
                        : ChevronsUpDown;
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sortable
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                      className={cn(
                        "min-w-24",
                        column.align === "end" ? "text-end" : "text-start",
                        column.className,
                      )}
                    >
                      {sortable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-0"
                          onClick={() => header.column.toggleSorting()}
                        >
                          <table.FlexRender header={header} />
                          <SortIcon aria-hidden="true" />
                        </Button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className={cn(stale && "opacity-70")}>
            {errorView != null ? (
              <TableRow>
                <TableCell colSpan={columnCount}>{errorView}</TableCell>
              </TableRow>
            ) : loading ? (
              <TableSkeleton
                columns={columns}
                count={skeletonRows}
                selectable={selection !== undefined}
              />
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <div role="status">
                    {filtered
                      ? (noMatchView ?? (
                          <EmptyState title={t("kit.table.noMatch")} />
                        ))
                      : (emptyView ?? (
                          <EmptyState title={t("kit.table.empty")} />
                        ))}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const entering = phase.current === "revealing";
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    data-motion-item={entering || undefined}
                    className={entering ? "kit-enter" : undefined}
                  >
                    {selection && (
                      <TableCell>
                        <Checkbox
                          aria-label={t("kit.table.selectRow", {
                            name: selection.rowLabel(row.original.value),
                          })}
                          checked={row.getIsSelected()}
                          onCheckedChange={(checked) =>
                            row.toggleSelected(checked === true)
                          }
                        />
                      </TableCell>
                    )}
                    {row.getAllCells().map((cell, index) => {
                      const column = columns[index];
                      const Cell = column.rowHeader ? TableHead : TableCell;
                      return (
                        <Cell
                          key={cell.id}
                          scope={column.rowHeader ? "row" : undefined}
                          className={cn(
                            "min-w-24",
                            column.align === "end" ? "text-end" : "text-start",
                            column.className,
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </Cell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {loading && (
          <span role="status" className="sr-only">
            {t("kit.table.loading")}
          </span>
        )}
      </ScrollArea>
    </div>
  );
}
