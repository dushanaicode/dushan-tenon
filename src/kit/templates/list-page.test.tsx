import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Button } from "../ui/button";
import type { DataTableProps } from "../ui/data-table";
import { EmptyState } from "../ui/empty-state";
import { ErrorView } from "../ui/error-view";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { ListPage } from "./list-page";

type Person = { id: string; name: string };

const table: DataTableProps<Person> = {
  caption: "用户列表",
  columns: [{ id: "name", header: "姓名", cell: (row) => row.name }],
  rows: [{ id: "alice", name: "Alice" }],
  getRowId: (row) => row.id,
};

it("按页头、筛选、表格、分页排列，透传筛选提交与页码变化", () => {
  const onSubmit = vi.fn();
  const onPageChange = vi.fn();
  const { container } = renderKit(
    <ListPage
      title="用户管理"
      description="查看用户"
      actions={<Button>创建用户</Button>}
      className="mt-2"
      filters={{
        label: "筛选用户",
        onSubmit,
        children: (
          <FormField label="关键词">
            {(control) => <Input {...control} name="query" />}
          </FormField>
        ),
      }}
      table={table}
      pagination={{ page: 1, pageSize: 10, total: 21, onPageChange }}
    />,
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root.getAttribute("data-slot")).toBe("list-page");
  expect(root.classList.contains("gap-stack")).toBe(true);
  expect(root.classList.contains("mt-2")).toBe(true);
  expect(
    Array.from(root.children, (element) => element.getAttribute("data-slot")),
  ).toEqual([
    "page-header",
    "filter-bar",
    "table-container",
    "list-page-pagination",
  ]);
  expect(screen.getByRole("heading", { name: "用户管理" })).toBeTruthy();
  expect(screen.getByText("查看用户")).toBeTruthy();
  expect(screen.getByRole("button", { name: "创建用户" })).toBeTruthy();
  expect(screen.getByRole("table", { name: "用户列表" })).toBeTruthy();
  expect(screen.getByRole("cell", { name: "Alice" })).toBeTruthy();
  expect(root.lastElementChild?.classList.contains("justify-end")).toBe(true);
  fireEvent.change(screen.getByLabelText("关键词"), {
    target: { value: "Alice" },
  });
  fireEvent.submit(screen.getByRole("search", { name: "筛选用户" }));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0][0].get("query")).toBe("Alice");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
});

it("未提供筛选与分页时只渲染页头和表格", () => {
  const { container } = renderKit(<ListPage title="用户" table={table} />);
  expect(screen.queryByRole("search")).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(container.firstElementChild?.children).toHaveLength(2);
  expect(screen.getByRole("table")).toBeTruthy();
  expect(container.querySelector("main")).toBeNull();
});

it("空态、无匹配与错误态完全由 table 属性驱动", () => {
  const { rerender } = renderKit(
    <ListPage
      title="用户"
      table={{
        ...table,
        rows: [],
        emptyView: <EmptyState title="尚未添加用户" />,
      }}
    />,
  );
  expect(screen.getByText("尚未添加用户")).toBeTruthy();
  expect(screen.queryByText("Alice")).toBeNull();
  rerender(
    <ListPage
      title="用户"
      table={{
        ...table,
        rows: [],
        filtered: true,
        noMatchView: <EmptyState title="没有匹配用户" />,
      }}
    />,
  );
  expect(screen.getByText("没有匹配用户")).toBeTruthy();
  rerender(
    <ListPage
      title="用户"
      table={{ ...table, errorView: <ErrorView message="无法读取用户" /> }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("无法读取用户");
  expect(screen.queryByText("Alice")).toBeNull();
});

it("首次加载和刷新状态透传给 DataTable", () => {
  const { container, rerender } = renderKit(
    <ListPage title="用户" table={{ ...table, rows: undefined }} />,
  );
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(screen.getByRole("status").textContent).toBe("正在加载…");
  rerender(<ListPage title="用户" table={{ ...table, refreshing: true }} />);
  expect(screen.getByRole("cell", { name: "Alice" })).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "用户列表" }).getAttribute("aria-busy"),
  ).toBe("true");
  expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
