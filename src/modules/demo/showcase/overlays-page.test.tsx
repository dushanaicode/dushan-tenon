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

import catalog from "./catalog/overlays.json";
import * as module1 from "./examples/confirm-dialog";
import source1 from "./examples/confirm-dialog.tsx?raw";
import * as module0 from "./examples/dialog";
import source0 from "./examples/dialog.tsx?raw";
import * as module3 from "./examples/popover";
import source3 from "./examples/popover.tsx?raw";
import * as module2 from "./examples/sheet";
import source2 from "./examples/sheet.tsx?raw";
import * as module4 from "./examples/tooltip";
import source4 from "./examples/tooltip.tsx?raw";
import { OverlaysPage, overlaysExamples } from "./pages/overlays-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => vi.restoreAllMocks());

test("seven live blocks use the catalog's exact rendered modules and source bytes", async () => {
  const spies = [
    vi.spyOn(module0, "DialogExample"),
    vi.spyOn(module1, "ConfirmDialogExample"),
    vi.spyOn(module2, "SheetExample"),
    vi.spyOn(module3, "PopoverExample"),
    vi.spyOn(module4, "TooltipExample"),
  ];
  const sources = [source0, source1, source2, source3, source4];
  const view = render(
    <MemoryRouter>
      <OverlaysPage />
    </MemoryRouter>,
  );
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  expect(new Set(catalog.map((entry) => entry.exampleFile))).toEqual(
    new Set(overlaysExamples.map((example) => example.file)),
  );
  for (const [index, example] of overlaysExamples.entries()) {
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

test("failed submission preserves long input; second submit succeeds and returns focus", async () => {
  render(<module0.DialogExample />);
  const trigger = screen.getByRole("button", { name: "短表单 · 先失败再成功" });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "编辑虚构片段" });
  const input = within(dialog).getByRole("textbox", { name: "片段名称" });
  const name = "用于核验长中文输入和失败后保留的虚构片段".repeat(4);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存片段" }));
  expect(within(dialog).getByRole("alert").textContent).toContain(
    "拒绝了第一次保存",
  );
  expect(input).toHaveProperty("value", name);
  expect(screen.getByRole("dialog")).toBe(dialog);
  const close = within(dialog).getByRole("button", { name: "关闭" });
  act(() => close.focus());
  fireEvent.keyDown(close, { key: "Tab" });
  expect(document.activeElement).toBe(input);
  fireEvent.click(within(dialog).getByRole("button", { name: "保存片段" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("status").textContent).toContain(name);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("destructive confirmation starts at Cancel, traps focus and ignores outside clicks", async () => {
  render(<module1.ConfirmDialogExample />);
  const trigger = screen.getByRole("button", { name: "危险确认" });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("alertdialog");
  const cancel = within(dialog).getByRole("button", { name: "取消" });
  expect(document.activeElement).toBe(cancel);
  const remove = within(dialog).getByRole("button", { name: "移除片段" });
  act(() => remove.focus());
  fireEvent.keyDown(remove, { key: "Tab" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.pointerDown(
    document.querySelector('[data-slot="alert-dialog-overlay"]') as HTMLElement,
    { button: 0 },
  );
  expect(screen.getByRole("alertdialog")).toBe(dialog);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.getByRole("status").textContent).toBe("尚未执行确认动作");
  fireEvent.click(screen.getByRole("button", { name: "普通确认" }));
  fireEvent.click(await screen.findByRole("button", { name: "完成演示" }));
  expect(screen.getByRole("status").textContent).toBe("本次演示已完成");
});

test("sheet saves local edits and restores its trigger", async () => {
  render(<module2.SheetExample />);
  const trigger = screen.getByRole("button", { name: "侧滑编辑" });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "编辑片段详情" });
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "虚构侧滑草稿" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存侧滑内容" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("status").textContent).toContain("虚构侧滑草稿");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("popover is named, controls local state and Escape restores focus; tooltip repeats visible text", async () => {
  const view = render(<module3.PopoverExample />);
  const trigger = screen.getByRole("button", { name: "轻量弹出层" });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "本页视图选项" });
  fireEvent.click(within(dialog).getByRole("switch", { name: "显示补充信息" }));
  expect(screen.getByRole("status").textContent).toBe("补充信息已隐藏");
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  view.unmount();
  render(<module4.TooltipExample />);
  const hint = screen.getByRole("button", { name: "提示说明" });
  fireEvent.focus(hint);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toContain("不承载唯一信息");
  expect(
    screen.getAllByText(
      "提示只补充说明，不承载唯一信息；同一说明也保留在页面上。",
    ).length,
  ).toBeGreaterThan(1);
});
