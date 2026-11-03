import { readdirSync, readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@/core/i18n";
import "@/core/core.test-support";
import * as kit from "@/kit";
import type { CatalogEntry } from "../selection-hint";
import { CatalogPage } from "./catalog-page";

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => access.allowed }));
const entries: CatalogEntry[] = readdirSync("src/modules/demo/showcase/catalog")
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) =>
    JSON.parse(
      readFileSync(`src/modules/demo/showcase/catalog/${file}`, "utf8"),
    ),
  );
const mount = () =>
  render(
    <MemoryRouter>
      <CatalogPage />
    </MemoryRouter>,
  );
beforeEach(() => {
  access.allowed = true;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("all catalog files supply real rows, seven columns and permission-filtered anchor links without source code", () => {
  const view = mount();
  const table = screen.getByRole("table", { name: "场景选型表" });
  expect(within(table).getAllByRole("columnheader")).toHaveLength(7);
  expect(within(table).getAllByRole("row")).toHaveLength(entries.length + 1);
  for (const entry of entries) {
    const row = screen
      .getByRole("rowheader", { name: i18n.t(entry.titleKey) })
      .closest("tr") as HTMLElement;
    expect(within(row).getByRole("link").getAttribute("href")).toBe(
      `${entry.page}#${entry.id}`,
    );
    expect(within(row).getByText(entry.exampleFile)).toBeTruthy();
  }
  expect(
    view.container.querySelectorAll('[data-showcase-block="theme"]'),
  ).toHaveLength(0);
  expect(view.container.querySelector("pre")).toBeNull();
  access.allowed = false;
  view.rerender(
    <MemoryRouter>
      <CatalogPage />
    </MemoryRouter>,
  );
  expect(within(table).queryAllByRole("link")).toEqual([]);
  expect(within(table).getAllByText("当前无权打开此示例页。")).toHaveLength(
    entries.length,
  );
});

test("search matches translated scenarios, solutions, usage and rules; filters combine and clear without rebuilding columns", async () => {
  const tableSpy = vi.spyOn(kit, "DataTable");
  mount();
  const columns = tableSpy.mock.calls.at(-1)?.[0].columns;
  const buttonEntry = entries.filter(
    (entry) => entry.id === "component.button",
  )[0];
  const search = screen.getByRole("searchbox", { name: "搜索场景与方案" });
  for (const text of [
    "BUTTON",
    "@/KIT",
    "图标动作",
    "SC-R01",
    "加载时阻止重复提交",
  ]) {
    fireEvent.change(search, { target: { value: text } });
    expect(
      screen.getByRole("rowheader", { name: i18n.t(buttonEntry.titleKey) }),
    ).toBeTruthy();
    expect(tableSpy.mock.calls.at(-1)?.[0].columns).toBe(columns);
  }
  fireEvent.change(search, { target: { value: " " } });
  const component = screen.getByRole("button", { name: "组件" });
  const pattern = screen.getByRole("button", { name: "组合模式" });
  act(() => component.focus());
  fireEvent.keyDown(component, { key: "ArrowRight" });
  await waitFor(() => expect(document.activeElement).toBe(pattern));
  fireEvent.click(pattern);
  expect(pattern.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("rowheader")).toHaveLength(
    entries.filter((entry) => entry.kind === "pattern").length,
  );
  fireEvent.click(component);
  expect(screen.getAllByRole("rowheader")).toHaveLength(
    entries.filter((entry) => ["component", "pattern"].includes(entry.kind))
      .length,
  );
  fireEvent.change(search, { target: { value: "没有这个场景".repeat(40) } });
  expect(screen.queryByRole("rowheader")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(search).toHaveProperty("value", "");
  expect(pattern.getAttribute("aria-pressed")).toBe("false");
  expect(component.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getAllByRole("rowheader")).toHaveLength(entries.length);
});

test("copies only the file path and offers selectable read-only text when clipboard writing fails", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  mount();
  const file = entries[0].exampleFile;
  const copy = screen.getByRole("button", { name: `复制示例路径：${file}` });
  fireEvent.click(copy);
  await screen.findByText("示例路径已复制。");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(file);
  writeText.mockRejectedValue(new Error("denied"));
  fireEvent.click(copy);
  const fallback = await screen.findByRole("textbox", {
    name: `可复制的示例路径：${file}`,
  });
  expect(fallback).toHaveProperty("readOnly", true);
  expect(fallback).toHaveProperty("value", file);
  act(() => fallback.focus());
  expect(fallback).toHaveProperty("selectionStart", 0);
  expect(fallback).toHaveProperty("selectionEnd", file.length);
});
