import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactNode, StrictMode, useState } from "react";
import { expect, it, vi } from "vitest";
import { withKitI18n } from "../kit.test-support";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
} from "./data-table";

function renderTable(ui: ReactNode) {
  return render(ui, { wrapper: ({ children }) => withKitI18n(children) });
}

const columns: readonly DataTableColumn<string>[] = [
  { id: "name", header: "名称", cell: (row) => row, sortable: true },
];
const tableProps = {
  caption: "任务列表",
  columns,
  getRowId: (row: string) => row,
};
const firstBatch = ["alpha", "beta", "gamma"];

it("排序提交后三态切换，保持服务器行序并隔离其他表格", () => {
  const sortableColumns = [
    ...columns,
    { ...columns[0], id: "other", header: "另一列" },
  ];
  function SortedTable() {
    const [value, onChange] = useState<DataTableSortState | null>(null);
    return (
      <DataTable
        {...tableProps}
        columns={sortableColumns}
        rows={firstBatch}
        sorting={{ value, onChange }}
      />
    );
  }
  renderTable(
    <StrictMode>
      <SortedTable />
      <DataTable
        {...tableProps}
        caption="另一个表"
        rows={firstBatch}
        sorting={{ value: null, onChange: vi.fn() }}
      />
    </StrictMode>,
  );
  const region = screen.getByRole("region", { name: tableProps.caption });
  const expected = [
    ["ascending", "none"],
    ["descending", "none"],
    ["none", "none"],
    ["none", "ascending"],
    ["ascending", "none"],
  ];
  for (const [index, name] of [
    "名称",
    "名称",
    "名称",
    "另一列",
    "名称",
  ].entries()) {
    fireEvent.click(within(region).getByRole("button", { name }));
    expect(
      within(region)
        .getAllByRole("columnheader")
        .map((head) => head.getAttribute("aria-sort")),
    ).toEqual(expected[index]);
    expect(
      within(region)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0].textContent),
    ).toEqual(firstBatch);
  }
  expect(
    within(screen.getByRole("region", { name: "另一个表" }))
      .getByRole("columnheader")
      .getAttribute("aria-sort"),
  ).toBe("none");
});

it("排序请求由父层决定，外部提交更新表头", () => {
  const changed = vi.fn();
  const { rerender } = renderTable(
    <DataTable
      {...tableProps}
      rows={firstBatch}
      sorting={{ value: { id: "name", desc: false }, onChange: changed }}
    />,
  );
  const header = screen.getByRole("columnheader", { name: "名称" });
  fireEvent.click(within(header).getByRole("button", { name: "名称" }));
  expect(changed).toHaveBeenCalledExactlyOnceWith({ id: "name", desc: true });
  expect(header.getAttribute("aria-sort")).toBe("ascending");
  rerender(
    <DataTable
      {...tableProps}
      rows={[...firstBatch]}
      sorting={{ value: { id: "name", desc: false }, onChange: changed }}
    />,
  );
  expect(header.getAttribute("aria-sort")).toBe("ascending");
  rerender(
    <DataTable
      {...tableProps}
      rows={firstBatch}
      sorting={{ value: { id: "name", desc: true }, onChange: changed }}
    />,
  );
  expect(header.getAttribute("aria-sort")).toBe("descending");
  expect(changed).toHaveBeenCalledOnce();
});

it("选择由父层控制，当前页全选保留页外 ID 且不修改入参", () => {
  const value = new Set(["outside", "alpha"]);
  const onChange = vi.fn();
  const selection = { value, onChange, rowLabel: (row: string) => row };
  const { rerender } = renderTable(
    <DataTable {...tableProps} rows={firstBatch} selection={selection} />,
  );
  const all = screen.getByRole("checkbox", { name: "全选" });
  const beta = screen.getByRole("checkbox", { name: "选择 beta" });
  expect(all.getAttribute("aria-checked")).toBe("mixed");
  fireEvent.click(beta);
  expect(onChange).toHaveBeenLastCalledWith(
    new Set(["outside", "alpha", "beta"]),
  );
  expect(beta.getAttribute("aria-checked")).toBe("false");
  expect(value).toEqual(new Set(["outside", "alpha"]));
  fireEvent.click(all);
  const selected = new Set(["outside", ...firstBatch]);
  expect(onChange).toHaveBeenLastCalledWith(selected);
  rerender(
    <DataTable
      {...tableProps}
      rows={[...firstBatch].reverse()}
      selection={{ ...selection, value: selected }}
    />,
  );
  expect(all.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("checkbox", { name: "选择 beta" })).toBe(beta);
  expect(beta.closest("tr")?.getAttribute("data-state")).toBe("selected");
  fireEvent.click(all);
  expect(onChange).toHaveBeenLastCalledWith(new Set(["outside"]));
  expect(selected).toEqual(new Set(["outside", ...firstBatch]));
});

it.each([false, true])(
  "普通列表头和单元格默认最小宽度为 6 rem，rowHeader=%s",
  (rowHeader) => {
    renderTable(
      <DataTable
        {...tableProps}
        columns={[{ ...columns[0], rowHeader }]}
        rows={["alpha"]}
      />,
    );
    for (const cell of [
      screen.getByRole("columnheader", { name: "名称" }),
      screen.getByRole(rowHeader ? "rowheader" : "cell", { name: "alpha" }),
    ]) {
      expect(cell.classList.contains("min-w-24")).toBe(true);
    }
  },
);

it.each([false, true])(
  "列的显式最小宽度覆盖表头和单元格默认值，rowHeader=%s",
  (rowHeader) => {
    renderTable(
      <DataTable
        {...tableProps}
        columns={[{ ...columns[0], rowHeader, className: "min-w-40" }]}
        rows={["alpha"]}
      />,
    );
    for (const cell of [
      screen.getByRole("columnheader", { name: "名称" }),
      screen.getByRole(rowHeader ? "rowheader" : "cell", { name: "alpha" }),
    ]) {
      expect(cell.classList.contains("min-w-40")).toBe(true);
      expect(cell.classList.contains("min-w-24")).toBe(false);
    }
  },
);

it("选择列不应用普通列的默认最小宽度", () => {
  renderTable(
    <DataTable
      {...tableProps}
      rows={["alpha"]}
      selection={{
        value: new Set(),
        onChange: vi.fn(),
        rowLabel: (row) => row,
      }}
    />,
  );
  const header = screen.getAllByRole("columnheader")[0];
  expect(header.classList.contains("w-12")).toBe(true);
  expect(header.classList.contains("min-w-24")).toBe(false);
  expect(screen.getAllByRole("cell")[0].classList.contains("min-w-24")).toBe(
    false,
  );
});

it.each([
  { label: "空态", rows: [] },
  {
    label: "错误",
    rows: firstBatch,
    errorView: <div role="alert">读取失败</div>,
  },
  { label: "骨架", rows: undefined },
])("$label 单元格不应用普通列的默认最小宽度", (props) => {
  const { container } = renderTable(<DataTable {...tableProps} {...props} />);
  const cells = container.querySelectorAll("tbody td");
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    expect(cell.classList.contains("min-w-24")).toBe(false);
  }
});

it("骨架首次变为数据时，首批所有行统一淡入，无错峰样式", () => {
  const { container, rerender } = renderTable(
    <DataTable {...tableProps} rows={undefined} skeletonRows={3} />,
  );
  expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  expect(container.querySelector("tr.kit-enter")).toBeNull();

  rerender(
    <DataTable
      {...tableProps}
      rows={Array.from({ length: 12 }, (_, index) => `row-${index}`)}
    />,
  );
  const rows = container.querySelectorAll<HTMLTableRowElement>("tbody tr");
  expect(rows).toHaveLength(12);
  rows.forEach((row) => {
    expect(row.classList.contains("kit-enter")).toBe(true);
    expect(row.hasAttribute("data-motion-item")).toBe(true);
    expect(row.getAttribute("style")).toBeNull();
  });
  expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  expect(container.querySelector("thead .kit-enter")).toBeNull();
});

it("翻页与筛选的新 ID 不入场，再次加载也不替换首批集合", () => {
  const { container, rerender } = renderTable(
    <DataTable {...tableProps} rows={undefined} />,
  );
  rerender(<DataTable {...tableProps} rows={firstBatch} />);

  for (const batch of [["delta", "epsilon"], ["zeta"]]) {
    rerender(<DataTable {...tableProps} rows={batch} filtered />);
    const rows = container.querySelectorAll<HTMLTableRowElement>("tbody tr");
    expect(rows).toHaveLength(batch.length);
    for (const row of rows) {
      expect(row.classList.contains("kit-enter")).toBe(false);
      expect(row.hasAttribute("data-motion-item")).toBe(false);
      expect(row.getAttribute("style")).toBeNull();
    }
    rerender(<DataTable {...tableProps} rows={undefined} />);
  }
});

it("刷新和同 ID 重排保留首批 DOM 与类名，集合变化结束入场", () => {
  const { container, rerender } = renderTable(
    <DataTable {...tableProps} rows={undefined} />,
  );
  rerender(<DataTable {...tableProps} rows={firstBatch} />);
  const initialRows = Array.from(
    container.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  );
  const classNames = initialRows.map((row) => row.className);

  rerender(<DataTable {...tableProps} rows={[...firstBatch]} refreshing />);
  expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("region").getAttribute("data-refreshing")).toBe(
    "true",
  );
  expect(
    container.querySelector("tbody")?.classList.contains("opacity-70"),
  ).toBe(true);
  container.querySelectorAll("tbody tr").forEach((row, index) => {
    expect(row).toBe(initialRows[index]);
    expect(row.className).toBe(classNames[index]);
  });

  rerender(
    <DataTable
      {...tableProps}
      rows={[...firstBatch].reverse()}
      sorting={{ value: { id: "name", desc: true }, onChange: vi.fn() }}
    />,
  );
  container
    .querySelectorAll<HTMLTableRowElement>("tbody tr")
    .forEach((row, index) => {
      const originalIndex = initialRows.length - 1 - index;
      expect(row).toBe(initialRows[originalIndex]);
      expect(row.className).toBe(classNames[originalIndex]);
      expect(row.hasAttribute("data-motion-item")).toBe(true);
      expect(row.getAttribute("style")).toBeNull();
    });
  expect(container.querySelectorAll("tr.kit-enter")).toHaveLength(3);

  rerender(<DataTable {...tableProps} rows={[...firstBatch, "delta"]} />);
  const added = screen.getByRole("cell", { name: "delta" }).closest("tr");
  expect(added?.classList.contains("kit-enter")).toBe(false);
  expect(added?.hasAttribute("data-motion-item")).toBe(false);
  expect(container.querySelectorAll("tr.kit-enter")).toHaveLength(0);
  expect(container.querySelector("tr[data-motion-item]")).toBeNull();
});

it("挂载时已有数据且未经历骨架的表格不入场", () => {
  const { container, rerender } = renderTable(
    <DataTable {...tableProps} rows={firstBatch} />,
  );
  expect(container.querySelector(".kit-enter")).toBeNull();
  expect(container.querySelector("[data-motion-item]")).toBeNull();

  rerender(<DataTable {...tableProps} rows={["delta"]} refreshing />);
  expect(container.querySelector(".kit-enter")).toBeNull();
  expect(container.querySelector("[data-motion-item]")).toBeNull();

  rerender(<DataTable {...tableProps} rows={undefined} />);
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  rerender(<DataTable {...tableProps} rows={firstBatch} />);
  expect(container.querySelector(".kit-enter")).toBeNull();
  expect(container.querySelector("[data-motion-item]")).toBeNull();
});

it.each([
  ["翻页", ["delta", "epsilon"], false],
  ["骨架", undefined, false],
  ["空态", [], false],
  ["错误", firstBatch, true],
  ["行数减少", firstBatch.slice(0, 2), false],
  ["等量替换 ID", ["alpha", "beta", "delta"], false],
] as const)("首批入场后经历%s，再回到首批 ID 不重播", (_, rows, failed) => {
  const { container, rerender } = renderTable(
    <DataTable {...tableProps} rows={undefined} />,
  );
  rerender(<DataTable {...tableProps} rows={firstBatch} />);
  expect(container.querySelectorAll("tbody tr.kit-enter")).toHaveLength(3);

  rerender(
    <DataTable
      {...tableProps}
      rows={rows}
      errorView={failed ? <div role="alert">读取失败</div> : undefined}
    />,
  );
  expect(container.querySelector("tr.kit-enter")).toBeNull();
  expect(container.querySelector("tr[data-motion-item]")).toBeNull();

  rerender(<DataTable {...tableProps} rows={firstBatch} />);
  const restored = container.querySelectorAll<HTMLTableRowElement>("tbody tr");
  expect(restored).toHaveLength(3);
  for (const row of restored) {
    expect(row.classList.contains("kit-enter")).toBe(false);
    expect(row.hasAttribute("data-motion-item")).toBe(false);
    expect(row.getAttribute("style")).toBeNull();
  }
});

it("错误优先于数据，不消耗骨架后的首次入场机会", () => {
  const { container, rerender } = renderTable(
    <DataTable {...tableProps} rows={undefined} />,
  );
  rerender(
    <DataTable
      {...tableProps}
      rows={firstBatch}
      errorView={<div role="alert">读取失败</div>}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("读取失败");
  expect(screen.queryByText("alpha")).toBeNull();
  expect(container.querySelector(".kit-enter")).toBeNull();
  expect(container.querySelector("[data-motion-item]")).toBeNull();

  rerender(<DataTable {...tableProps} rows={["delta"]} />);
  expect(container.querySelectorAll("tbody tr.kit-enter")).toHaveLength(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("只有错误而未显示骨架时，恢复数据不入场", () => {
  const { container, rerender } = renderTable(
    <DataTable
      {...tableProps}
      rows={undefined}
      errorView={<div role="alert">读取失败</div>}
    />,
  );
  rerender(<DataTable {...tableProps} rows={firstBatch} />);
  expect(container.querySelector(".kit-enter")).toBeNull();
  expect(container.querySelector("[data-motion-item]")).toBeNull();
});

it("空态与无匹配不入场，也不消耗骨架后的首次数据入场机会", () => {
  const { container, rerender } = renderTable(
    <DataTable {...tableProps} rows={undefined} />,
  );
  rerender(<DataTable {...tableProps} rows={[]} />);
  expect(screen.getByRole("status").textContent).toBe("暂无数据");
  expect(container.querySelector(".kit-enter")).toBeNull();
  expect(container.querySelector("[data-motion-item]")).toBeNull();

  rerender(<DataTable {...tableProps} rows={[]} filtered />);
  expect(screen.getByRole("status").textContent).toBe("没有匹配的结果");
  expect(container.querySelector(".kit-enter")).toBeNull();
  expect(container.querySelector("[data-motion-item]")).toBeNull();

  rerender(<DataTable {...tableProps} rows={firstBatch} />);
  expect(container.querySelectorAll("tbody tr.kit-enter")).toHaveLength(3);
});
