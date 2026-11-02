import {
  act,
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
  ErrorView,
  FilterBar,
  FormField,
  Input,
  Pagination,
} from "@/kit";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";

let errorSpy: MockInstance;
let warnSpy: MockInstance;

beforeEach(() => {
  void i18n.changeLanguage("zh-CN");
  errorSpy = vi.spyOn(console, "error");
  warnSpy = vi.spyOn(console, "warn");
});

afterEach(() => {
  cleanup();
  try {
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
});

describe("Pagination", () => {
  it("控制边界和忙碌状态，报告相邻页，不夹取调用方页码", () => {
    const onPageChange = vi.fn();
    const props = { pageSize: 10, total: 21, onPageChange };
    const { rerender } = render(<Pagination {...props} page={1} />);
    const previous = screen.getByRole("button", {
      name: "上一页",
    }) as HTMLButtonElement;
    const next = screen.getByRole("button", {
      name: "下一页",
    }) as HTMLButtonElement;
    expect(screen.getByRole("navigation", { name: "分页" })).toBeTruthy();
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    fireEvent.click(previous);
    expect(onPageChange).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    rerender(<Pagination {...props} page={3} />);
    expect(next.disabled).toBe(true);
    expect(previous.disabled).toBe(false);
    fireEvent.click(previous);
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    rerender(<Pagination {...props} page={2} disabled />);
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    rerender(<Pagination {...props} page={1} total={0} />);
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    expect(screen.getByText("第 1 / 1 页，共 0 条")).toBeTruthy();
    rerender(<Pagination {...props} page={4} />);
    expect(screen.getByText("第 4 / 3 页，共 21 条")).toBeTruthy();
    fireEvent.click(previous);
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });

  it.each([
    ["zh-CN", "第 2 / 3 页，共 21 条", "分页"],
    ["en-US", "Page 2 of 3, 21 items", "Pagination"],
  ])("%s 摘要随语言变化并礼貌播报", async (language, summary, label) => {
    await act(() => i18n.changeLanguage(language));
    render(
      <Pagination page={2} pageSize={10} total={21} onPageChange={() => {}} />,
    );
    expect(screen.getByRole("navigation", { name: label })).toBeTruthy();
    expect(screen.getByText(summary).getAttribute("aria-live")).toBe("polite");
  });
});

describe("FilterBar", () => {
  it("以 FormData 提交不受控字段，阻止页面提交；重置先恢复字段再回调", () => {
    const onSubmit = vi.fn();
    const onReset = vi.fn(() => {
      expect((screen.getByLabelText("关键词") as HTMLInputElement).value).toBe(
        "",
      );
    });
    render(
      <FilterBar label="用户筛选" onSubmit={onSubmit} onReset={onReset}>
        <FormField label="关键词">
          {(control) => <Input {...control} name="query" defaultValue="" />}
        </FormField>
      </FilterBar>,
    );
    const form = screen.getByRole("search", { name: "用户筛选" });
    const input = screen.getByLabelText("关键词") as HTMLInputElement;
    expect((form as HTMLFormElement).noValidate).toBe(true);
    fireEvent.change(input, { target: { value: "Alice" } });
    expect(fireEvent.submit(form)).toBe(false);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toBeInstanceOf(FormData);
    expect(onSubmit.mock.calls[0][0].get("query")).toBe("Alice");
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(input.value).toBe("");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("pending 禁用提交，重置入口可选，支持调用方按钮文案", () => {
    const props = { onSubmit: vi.fn(), children: <span>条件</span> };
    const { rerender } = render(<FilterBar {...props} pending />);
    const submit = screen.getByRole("button", { name: "查询" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "重置" })).toBeNull();
    rerender(
      <FilterBar
        {...props}
        submitLabel="筛选"
        resetLabel="清空"
        onReset={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "筛选" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "清空" })).toBeTruthy();
  });
});

type Person = { id: string; name: string; count: number };

const people: readonly Person[] = [
  { id: "b", name: "Bob", count: 2 },
  { id: "a", name: "Alice", count: 1 },
];
const columns: readonly DataTableColumn<Person>[] = [
  {
    id: "name",
    header: "姓名",
    cell: (row) => row.name,
    rowHeader: true,
    sortable: true,
  },
  {
    id: "count",
    header: "数量",
    cell: (row) => row.count,
    align: "end",
    className: "font-mono",
  },
];
const tableProps = {
  caption: "用户列表",
  columns,
  getRowId: (row: Person) => row.id,
};

describe("DataTable", () => {
  it("公开泛型也接受原始值行，内部适配不改变 ID 和 cell 入参", () => {
    render(
      <DataTable<number>
        caption="计数"
        columns={[{ id: "value", header: "值", cell: (value) => value }]}
        rows={[20, 10]}
        getRowId={String}
      />,
    );
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(
      ["20", "10"],
    );
  });

  it("首次加载保留表头，按列和行数显示骨架与加载播报", () => {
    const { container, rerender } = render(
      <DataTable {...tableProps} rows={undefined} skeletonRows={3} />,
    );
    const region = screen.getByRole("region", { name: "用户列表" });
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("table", { name: "用户列表" })).toBeTruthy();
    expect(
      container.querySelector("caption")?.classList.contains("sr-only"),
    ).toBe(true);
    expect(screen.getByRole("columnheader", { name: "姓名" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "数量" })).toBeTruthy();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      6,
    );
    expect(screen.getByRole("status").textContent).toBe("正在加载…");
    expect(screen.getByRole("status").closest("tbody")).toBeNull();
    rerender(<DataTable {...tableProps} rows={undefined} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
  });

  it("使用原生表格和行标题，行 ID 在重排后保持 DOM；刷新保留旧行", () => {
    const { container, rerender } = render(
      <DataTable {...tableProps} rows={people} />,
    );
    const bob = screen.getByRole("rowheader", { name: "Bob" });
    expect(bob.tagName).toBe("TH");
    expect(bob.getAttribute("scope")).toBe("row");
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
    expect(
      screen.getByRole("columnheader", { name: "数量" }).className,
    ).toContain("text-end");
    expect(screen.getByRole("cell", { name: "2" }).className).toContain(
      "font-mono",
    );
    const row = bob.closest("tr");
    rerender(<DataTable {...tableProps} rows={[people[1], people[0]]} />);
    expect(screen.getByRole("rowheader", { name: "Bob" }).closest("tr")).toBe(
      row,
    );
    expect(
      screen.getAllByRole("rowheader").map((cell) => cell.textContent),
    ).toEqual(["Alice", "Bob"]);
    rerender(<DataTable {...tableProps} rows={people} refreshing />);
    expect(screen.getByRole("rowheader", { name: "Bob" })).toBeTruthy();
    const region = screen.getByRole("region", { name: "用户列表" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("data-refreshing")).toBe("true");
    expect(
      container.querySelector("tbody")?.classList.contains("opacity-70"),
    ).toBe(true);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<DataTable {...tableProps} rows={people} />);
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(region.hasAttribute("data-refreshing")).toBe(false);
  });

  it("区分无数据与无匹配，允许替换两种空态", () => {
    const { rerender } = render(<DataTable {...tableProps} rows={[]} />);
    expect(screen.getByRole("status").textContent).toBe("暂无数据");
    expect(screen.getByRole("cell").getAttribute("colspan")).toBe("2");
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    rerender(<DataTable {...tableProps} rows={[]} filtered />);
    expect(screen.getByRole("status").textContent).toBe("没有匹配的结果");
    const views = { emptyView: "先添加用户", noMatchView: "修改筛选条件" };
    rerender(<DataTable {...tableProps} {...views} rows={[]} />);
    expect(screen.getByRole("status").textContent).toBe("先添加用户");
    rerender(<DataTable {...tableProps} {...views} rows={[]} filtered />);
    expect(screen.getByRole("status").textContent).toBe("修改筛选条件");
  });

  it("错误优先于旧行和骨架，错误视图可重试且不重复添加角色", () => {
    const onRetry = vi.fn();
    const errorView = <ErrorView message="读取失败" onRetry={onRetry} />;
    const { container, rerender } = render(
      <DataTable {...tableProps} rows={people} errorView={errorView} />,
    );
    expect(screen.queryByRole("rowheader")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button"));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(
      <DataTable {...tableProps} rows={undefined} errorView={errorView} />,
    );
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("false");
  });

  it("排序必须显式开放，三态完全受控且不改变服务器行序", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DataTable {...tableProps} rows={people} />);
    const header = screen.getByRole("columnheader", { name: "姓名" });
    expect(within(header).queryByRole("button")).toBeNull();
    expect(header.hasAttribute("aria-sort")).toBe(false);
    const states: (DataTableSortState | null)[] = [
      null,
      { id: "name", desc: false },
      { id: "name", desc: true },
    ];
    const directions = ["none", "ascending", "descending"];
    states.forEach((value, index) => {
      rerender(
        <DataTable
          {...tableProps}
          rows={people}
          sorting={{ value, onChange }}
        />,
      );
      expect(header.getAttribute("aria-sort")).toBe(directions[index]);
      const button = within(header).getByRole("button", { name: "姓名" });
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      fireEvent.click(button);
      expect(onChange).toHaveBeenLastCalledWith(states[(index + 1) % 3]);
      // State stays unchanged until the parent accepts the callback value.
      expect(header.getAttribute("aria-sort")).toBe(directions[index]);
      expect(
        screen.getAllByRole("rowheader").map((cell) => cell.textContent),
      ).toEqual(["Bob", "Alice"]);
    });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(
      within(screen.getByRole("columnheader", { name: "数量" })).queryByRole(
        "button",
      ),
    ).toBeNull();
    rerender(<DataTable {...tableProps} rows={people} />);
    expect(within(header).queryByRole("button")).toBeNull();
    expect(header.hasAttribute("aria-sort")).toBe(false);
  });

  it("选择三态仅根据当前页计算，更新 Set 不修改入参且保留页外 ID", () => {
    const onChange = vi.fn();
    const rowLabel = (row: Person) => row.name;
    const value = new Set(["outside", "a"]);
    const selection = { value, onChange, rowLabel };
    const { rerender } = render(
      <DataTable {...tableProps} rows={people} selection={selection} />,
    );
    const all = screen.getByRole("checkbox", { name: "全选" });
    const alice = screen.getByRole("checkbox", { name: "选择 Alice" });
    const bob = screen.getByRole("checkbox", { name: "选择 Bob" });
    expect(all.getAttribute("aria-checked")).toBe("mixed");
    expect(alice.getAttribute("aria-checked")).toBe("true");
    expect(alice.closest("tr")?.getAttribute("data-state")).toBe("selected");
    expect(bob.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(bob);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["outside", "a", "b"]));
    expect(onChange.mock.calls[0][0]).not.toBe(value);
    expect(value).toEqual(new Set(["outside", "a"]));
    expect(bob.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(alice);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["outside"]));
    fireEvent.click(all);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["outside", "a", "b"]));
    expect(value).toEqual(new Set(["outside", "a"]));

    const selected = new Set(["outside", "a", "b"]);
    rerender(
      <DataTable
        {...tableProps}
        rows={people}
        selection={{ ...selection, value: selected }}
      />,
    );
    expect(all.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(all);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["outside"]));
    expect(selected).toEqual(new Set(["outside", "a", "b"]));
    rerender(
      <DataTable
        {...tableProps}
        rows={people}
        selection={{ ...selection, value: new Set(["outside"]) }}
      />,
    );
    expect(all.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(all);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["outside", "b", "a"]));
  });

  it("重排和换页后选择跟随稳定 ID，组件不清理页外选择", () => {
    const onChange = vi.fn();
    const selection = {
      value: new Set(["a"]),
      onChange,
      rowLabel: (row: Person) => row.name,
    };
    const { rerender } = render(
      <DataTable {...tableProps} rows={people} selection={selection} />,
    );
    const aliceRow = screen
      .getByRole("rowheader", { name: "Alice" })
      .closest("tr");
    rerender(
      <DataTable
        {...tableProps}
        rows={[people[1], people[0]]}
        selection={selection}
      />,
    );
    expect(screen.getByRole("rowheader", { name: "Alice" }).closest("tr")).toBe(
      aliceRow,
    );
    expect(
      screen
        .getByRole("checkbox", { name: "选择 Alice" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("checkbox", { name: "选择 Bob" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    rerender(
      <DataTable {...tableProps} rows={[people[0]]} selection={selection} />,
    );
    expect(onChange).not.toHaveBeenCalled();
    const all = screen.getByRole("checkbox", { name: "全选" });
    expect(all.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(all);
    expect(onChange).toHaveBeenLastCalledWith(new Set(["a", "b"]));
    expect(selection.value).toEqual(new Set(["a"]));
  });

  it("选择列计入骨架和空错态跨度，无当前页数据时不能全选", () => {
    const selection = {
      value: new Set<string>(),
      onChange: vi.fn(),
      rowLabel: (row: Person) => row.name,
    };
    const { container, rerender } = render(
      <DataTable {...tableProps} rows={undefined} selection={selection} />,
    );
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      15,
    );
    const all = screen.getByRole("checkbox", {
      name: "全选",
    }) as HTMLButtonElement;
    expect(all.disabled).toBe(true);
    rerender(<DataTable {...tableProps} rows={[]} selection={selection} />);
    expect(screen.getByRole("cell").getAttribute("colspan")).toBe("3");
    expect(all.disabled).toBe(true);
    rerender(
      <DataTable
        {...tableProps}
        rows={people}
        selection={selection}
        errorView={<ErrorView message="读取失败" />}
      />,
    );
    expect(screen.getByRole("cell").getAttribute("colspan")).toBe("3");
    expect(all.disabled).toBe(true);
    rerender(<DataTable {...tableProps} rows={people} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

const i18n = createKitTestI18n();
function render(ui: ReactNode) {
  return renderView(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}
