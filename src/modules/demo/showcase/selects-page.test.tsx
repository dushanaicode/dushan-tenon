import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import "@/core/core.test-support";
import catalog from "./catalog/selects.json";
import * as example1 from "./examples/combobox";
import source1 from "./examples/combobox.tsx?raw";
import * as example2 from "./examples/multi-select";
import source2 from "./examples/multi-select.tsx?raw";
import * as example0 from "./examples/select";
import source0 from "./examples/select.tsx?raw";
import { SelectsPage, selectsExamples } from "./pages/selects-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("selects: seven blocks, rendered modules, raw bytes and catalog are the same sources", async () => {
  const spies = [
    vi.spyOn(example0, "SelectExample"),
    vi.spyOn(example1, "ComboboxExample"),
    vi.spyOn(example2, "MultiSelectExample"),
  ];
  const router = createMemoryRouter([{ path: "*", element: <SelectsPage /> }], {
    initialEntries: ["/demo/selects"],
  });
  const view = render(<RouterProvider router={router} />);
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  const sources = [source0, source1, source2];
  expect(catalog).toHaveLength(sources.length);
  expect(new Set(catalog.map((entry) => entry.exampleFile)).size).toBe(
    sources.length,
  );
  for (const [i, source] of sources.entries()) {
    expect(source).toBe(readFileSync(catalog[i].exampleFile, "utf8"));
    expect(selectsExamples[i].file).toBe(catalog[i].exampleFile);
    expect((await selectsExamples[i].load?.())?.default).toBe(source);
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(sources.length),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
  for (const spy of spies) expect(spy).toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/demo/selects");
});

test("grouped select opens all long-list options, skips disabled and closes on selection", async () => {
  render(<example0.SelectExample />);
  const trigger = screen.getByRole("combobox", { name: "分组单选" });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const list = await screen.findByRole("listbox");
  expect(within(list).getAllByRole("option")).toHaveLength(27);
  expect(
    within(list)
      .getByRole("option", { name: "尚未开放的资料" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  const option = within(list).getByRole("option", { name: "虚构归档资料 24" });
  act(() => option.focus());
  fireEvent.keyDown(option, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(trigger.textContent).toContain("虚构归档资料 24");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("searchable combobox filters, selects, clears and restores trigger focus", async () => {
  render(<example1.ComboboxExample />);
  const trigger = screen.getByRole("combobox", { name: "可搜索单选" });
  fireEvent.click(trigger);
  const search = screen.getByRole("combobox", { name: "搜索资料名称" });
  fireEvent.change(search, { target: { value: "归档资料 24" } });
  fireEvent.click(
    await screen.findByRole("option", { name: "虚构归档资料 24" }),
  );
  expect(trigger.textContent).toContain("虚构归档资料 24");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: "清除选择" }));
  expect(trigger.textContent).toContain("请选择资料");
});

test("multi-select search preserves badges, keyboard toggles, Escape returns focus and clear removes all", async () => {
  render(<example2.MultiSelectExample />);
  const trigger = screen.getByRole("button", { name: "可搜索多选组合" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "可搜索多选组合" });
  const search = within(dialog).getByRole("combobox", { name: "搜索资料名称" });
  fireEvent.change(search, { target: { value: "纸飞机" } });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(trigger.textContent).toContain("已选 1 项");
  expect(
    within(dialog).getByRole("option", { name: "纸飞机，已选；激活以移除" }),
  ).toBeTruthy();
  fireEvent.change(search, { target: { value: "归档资料 24" } });
  fireEvent.click(
    await within(dialog).findByRole("option", {
      name: "虚构归档资料 24，未选；激活以添加",
    }),
  );
  expect(trigger.textContent).toContain("已选 2 项");
  expect(
    [...document.querySelectorAll('[data-slot="badge"]')].map(
      (node) => node.textContent,
    ),
  ).toEqual(["纸飞机", "虚构归档资料 24"]);
  fireEvent.keyDown(search, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger);
  expect(
    screen.getByRole("option", { name: "纸飞机，已选；激活以移除" }),
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "清空已选" }));
  expect(trigger.textContent).toContain("已选 0 项");
  expect(document.querySelectorAll('[data-slot="badge"]')).toHaveLength(0);
});

test("matrix covers six real states including errors, disabled fields and long selected labels", () => {
  const view = render(
    <MemoryRouter>
      <SelectsPage />
    </MemoryRouter>,
  );
  const matrix = view.container.querySelector(
    '[data-showcase-block="matrix"]',
  ) as HTMLElement;
  expect(matrix.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3);
  expect(
    matrix.querySelectorAll('[data-slot="select-trigger"][disabled]'),
  ).toHaveLength(1);
  expect(
    matrix.querySelectorAll('[data-slot="combobox"][disabled]'),
  ).toHaveLength(1);
  expect(
    within(matrix)
      .getAllByRole("button", { name: "可搜索多选组合" })
      .filter((button) => button.hasAttribute("disabled")),
  ).toHaveLength(1);
  expect(
    within(matrix).getAllByText(
      "用于验证窄窗口换行与完整可读性的中文长标题虚构资料",
    ).length,
  ).toBeGreaterThanOrEqual(3);
});
