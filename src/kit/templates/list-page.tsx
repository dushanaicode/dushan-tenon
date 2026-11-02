// 套件自写；许可见项目根 LICENSE。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableProps } from "../ui/data-table";
import { FilterBar, type FilterBarProps } from "../ui/filter-bar";
import { PageHeader } from "../ui/page-header";
import { Pagination, type PaginationProps } from "../ui/pagination";

export type ListPageProps<T> = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  filters?: Omit<FilterBarProps, "className">;
  table: DataTableProps<T>;
  pagination?: PaginationProps;
  className?: string;
};

export function ListPage<T>({
  title,
  description,
  actions,
  filters,
  table,
  pagination,
  className,
}: ListPageProps<T>) {
  return (
    <div
      data-slot="list-page"
      className={cn("flex min-w-0 flex-col gap-stack", className)}
    >
      <PageHeader title={title} description={description} actions={actions} />
      {filters && <FilterBar {...filters} />}
      <DataTable {...table} />
      {pagination && (
        <div data-slot="list-page-pagination" className="flex justify-end">
          <Pagination {...pagination} />
        </div>
      )}
    </div>
  );
}
