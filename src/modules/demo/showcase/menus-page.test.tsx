import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import "@/core/core.test-support";
import catalog from "./catalog/menus.json";
import * as example4 from "./examples/command-list";
import source4 from "./examples/command-list.tsx?raw";
import * as example1 from "./examples/context-menu";
import source1 from "./examples/context-menu.tsx?raw";
import * as example0 from "./examples/dropdown-menu";
import source0 from "./examples/dropdown-menu.tsx?raw";
import * as example3 from "./examples/hover-card";
import source3 from "./examples/hover-card.tsx?raw";
import * as example2 from "./examples/menubar";
import source2 from "./examples/menubar.tsx?raw";
import { MenusPage, menusExamples } from "./pages/menus-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("menus: seven blocks, rendered modules, raw bytes and catalog are the same sources", async () => {
  const spies = [
    vi.spyOn(example0, "DropdownMenuExample"),
    vi.spyOn(example1, "ContextMenuExample"),
    vi.spyOn(example2, "MenubarExample"),
    vi.spyOn(example3, "HoverCardExample"),
    vi.spyOn(example4, "CommandListExample"),
  ];
  const router = createMemoryRouter([{ path: "*", element: <MenusPage /> }], {
    initialEntries: ["/demo/menus"],
  });
  const view = render(<RouterProvider router={router} />);
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  const sources = [source0, source1, source2, source3, source4];
  expect(catalog).toHaveLength(sources.length);
  expect(new Set(catalog.map((entry) => entry.exampleFile)).size).toBe(
    sources.length,
  );
  for (const [i, source] of sources.entries()) {
    expect(source).toBe(readFileSync(catalog[i].exampleFile, "utf8"));
    expect(menusExamples[i].file).toBe(catalog[i].exampleFile);
    expect((await menusExamples[i].load?.())?.default).toBe(source);
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(sources.length),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
  for (const spy of spies) expect(spy).toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/demo/menus");
});

test("dropdown checkbox/radio stay open, submenu executes, disabled items do not, toolbar and avatar are real menus", async () => {
  render(<example0.DropdownMenuExample />);
  const trigger = screen.getByRole("button", { name: "记录操作" });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" });
  const menu = await screen.findByRole("menu", { name: "记录操作" });
  const checkbox = within(menu).getByRole("menuitemcheckbox", {
    name: "显示网格",
  });
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("menu")).toBe(menu);
  fireEvent.click(
    within(menu).getByRole("menuitemradio", { name: "紧凑间距" }),
  );
  expect(
    within(menu)
      .getByRole("menuitemradio", { name: "紧凑间距" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(
    within(menu).getByRole("menuitem", { name: "发布（未开放）" }),
  );
  expect(screen.getByRole("status", { hidden: true }).textContent).toBe(
    "尚未执行操作",
  );
  const sub = within(menu).getByRole("menuitem", { name: "导出示意" });
  act(() => sub.focus());
  fireEvent.keyDown(sub, { key: "ArrowRight" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "纯文本片段" }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.getByRole("status").textContent).toContain("没有生成文件");
  fireEvent.keyDown(trigger, { altKey: true, code: "KeyS" });
  expect(screen.getByRole("status").textContent).toBe("片段已保存到页面内存");
  fireEvent.pointerDown(screen.getByRole("button", { name: "更多工具" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制片段" }));
  expect(screen.getByRole("status").textContent).toContain("复制片段");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  fireEvent.pointerDown(screen.getByRole("button", { name: "虚构用户菜单" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "查看帮助示意" }),
  );
  expect(screen.getByRole("status").textContent).toContain("帮助示意");
});

test("each context region has an equivalent visible action and returns focus", async () => {
  render(<example1.ContextMenuExample />);
  for (const name of ["列表行：虚构草稿", "卡片：纸飞机", "空白画布"]) {
    const region = screen.getByRole("region", { name });
    const more = within(region).getByRole("button", { name: `${name}：更多` });
    act(() => more.focus());
    fireEvent.contextMenu(
      region.querySelector('[data-slot="context-menu-trigger"]') as Element,
      { clientX: 20, clientY: 20 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制片段" }));
    await waitFor(() => expect(document.activeElement).toBe(more));
    expect(within(region).getByRole("status").textContent).toBe("已复制 1 次");
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制片段" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(within(region).getByRole("status").textContent).toBe("已复制 2 次");
  }
});

test("menubar creates and undoes local fragments; view checkbox keeps the menu open", async () => {
  render(<example2.MenubarExample />);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "文件" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "新建片段" }));
  expect(screen.getByRole("status").textContent).toContain("1 个片段");
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "编辑" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "撤销新建" }));
  expect(screen.getByRole("status").textContent).toContain("0 个片段");
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "视图" }), {
    key: "ArrowDown",
  });
  const item = await screen.findByRole("menuitemcheckbox", {
    name: "显示参考线",
  });
  fireEvent.click(item);
  expect(item.getAttribute("aria-checked")).toBe("false");
  fireEvent.keyDown(item, { key: "Escape" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "视图" }),
    ),
  );
});

test("hover summary and explicit popover contain the same summary; Escape restores focus", async () => {
  vi.useFakeTimers();
  render(<example3.HoverCardExample />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: "悬停查看摘要" }), {
    pointerType: "mouse",
  });
  act(() => vi.advanceTimersByTime(150));
  const hoverText = document.querySelector(
    '[data-kit="hover-card"]',
  )?.textContent;
  expect(hoverText).toContain("3 个草稿");
  fireEvent.pointerLeave(screen.getByRole("button", { name: "悬停查看摘要" }), {
    pointerType: "mouse",
  });
  await act(async () => vi.advanceTimersByTime(200));
  vi.useRealTimers();
  const trigger = screen.getByRole("button", { name: "点击查看摘要" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "纸飞机资料（虚构）" });
  expect(dialog.textContent).toBe(hoverText);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("inline commands search, execute with Enter and expose a real empty state", async () => {
  render(<example4.CommandListExample />);
  const input = screen.getByRole("combobox", { name: "搜索示例命令" });
  fireEvent.change(input, { target: { value: "复制" } });
  expect(await screen.findByRole("option", { name: "复制片段" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "保存片段" })).toBeNull();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("status").textContent).toContain("复制片段");
  fireEvent.change(input, { target: { value: "不存在的命令" } });
  expect(await screen.findByText("没有匹配的命令")).toBeTruthy();
});
