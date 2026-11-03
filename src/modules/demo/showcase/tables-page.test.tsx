import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import "@/core/core.test-support";

import catalog from "./catalog/tables.json";
import * as module0 from "./examples/data-table";
import source0 from "./examples/data-table.tsx?raw";
import * as module2 from "./examples/filter-bar";
import source2 from "./examples/filter-bar.tsx?raw";
import * as module1 from "./examples/row-actions";
import source1 from "./examples/row-actions.tsx?raw";
import { TablesPage, tablesExamples } from "./pages/tables-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => vi.restoreAllMocks());

test("seven live blocks use the catalog's exact rendered modules and source bytes", async () => {
  const spies = [
    vi.spyOn(module0, "DataTableExample"),
    vi.spyOn(module1, "RowActionsExample"),
    vi.spyOn(module2, "FilterBarExample"),
  ];
  const sources = [source0, source1, source2];
  const view = render(
    <MemoryRouter>
      <TablesPage />
    </MemoryRouter>,
  );
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  expect(new Set(catalog.map((entry) => entry.exampleFile))).toEqual(
    new Set(tablesExamples.map((example) => example.file)),
  );
  for (const [index, example] of tablesExamples.entries()) {
    expect(sources[index]).toBe(readFileSync(example.file, "utf8"));
    expect((await example.load?.())?.default).toBe(sources[index]);
    expect(spies[index]).toHaveBeenCalled();
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(sources.length),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
});

test("sorting changes record order, selection and paging work, filters reset the page", () => {
  render(<module0.DataTableExample />);
  const table = screen.getByRole("table", { name: "虚构观测记录 · 每页两条" });
  const records = () =>
    within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
  expect(records()[0]).toContain("纸月观测");
  fireEvent.click(
    within(table).getByRole("button", { name: "记录 · 按分片数排序" }),
  );
  expect(records()[0]).toContain("蓝砂整理");
  expect(table.querySelector('[aria-sort="ascending"]')).toBeTruthy();
  fireEvent.click(within(table).getAllByRole("checkbox")[1]);
  expect(screen.getByText("已选择 1 条")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(records()[0]).toContain("雾谷归档");
  expect(screen.getByRole("button", { name: "下一页" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "记录名称" }), {
    target: { value: "远岸" },
  });
  fireEvent.submit(screen.getByRole("search", { name: "筛选表格" }));
  expect(records()).toHaveLength(1);
  expect(records()[0]).toContain("远岸星图校验与长中文名称换行演示记录");
  expect(screen.getByRole("button", { name: "上一页" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByText("已选择 0 条")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "不存在的虚构名称" },
  });
  fireEvent.submit(screen.getByRole("search"));
  expect(screen.getByText("没有匹配记录")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重置" }));
  expect(records()).toHaveLength(2);
});

test("table empty, loading and failed states do not display stale records; retry restores them", () => {
  const view = render(<module0.DataTableExample />);
  fireEvent.click(screen.getByRole("button", { name: "空数据" }));
  expect(screen.getByText("演示集合为空")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "加载中" }));
  expect(view.container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  expect(screen.queryByText("纸月观测")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "错误" }));
  expect(screen.getByRole("alert").textContent).toContain("读取失败");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(screen.getByText("纸月观测")).toBeTruthy();
});

test("visible and context menus share state, disabled actions, keyboard access and focus return", async () => {
  const view = render(<module1.RowActionsExample />);
  const more = screen.getByRole("button", { name: "更多：纸月观测" });
  act(() => more.focus());
  fireEvent.keyDown(more, { key: "Enter" });
  const clear = await screen.findByRole("menuitem", { name: "清除标记" });
  expect(clear.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("menuitem", { name: "标记此记录" }));
  expect(screen.getByText("已标记")).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(more));
  fireEvent.contextMenu(
    view.container.querySelector(
      '[data-slot="context-menu-trigger"]',
    ) as HTMLElement,
    { clientX: 40, clientY: 40 },
  );
  const mark = await screen.findByRole("menuitem", { name: "标记此记录" });
  expect(mark.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("menuitem", { name: "清除标记" }));
  expect(screen.getByText("未标记")).toBeTruthy();
});

test("the standalone filter updates its displayed records and resets", () => {
  render(<module2.FilterBarExample />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "纸月" } });
  fireEvent.submit(screen.getByRole("search"));
  expect(screen.getByRole("status").textContent).toBe("匹配 1 条记录");
  expect(screen.queryByText("蓝砂整理")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重置" }));
  expect(screen.getByRole("status").textContent).toBe("匹配 4 条记录");
});
