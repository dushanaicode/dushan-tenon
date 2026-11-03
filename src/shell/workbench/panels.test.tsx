import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/kit";
import {
  job,
  manifest,
  mockShellIpc,
  renderShell,
  resizeShell,
  visibility,
} from "../shell.test-support";
import { objectContributions } from "./objects";
import { accessiblePanels, panelContributions } from "./panels";

it("宽档停靠，窄档 sheet，Esc 返回辅助触发器；响应式不保存几何", async () => {
  const { calls } = mockShellIpc(undefined, {
    objects: [job],
    activeObject: job,
    auxiliary: { width: 400, visible: true, panel: "inspector" },
  });
  renderShell({}, `/devtools/jobs/${job.id}`);
  await screen.findByText(`检查 ${job.id}`);
  resizeShell(900);
  fireEvent.click(screen.getByRole("button", { name: "切换任务辅助栏" }));
  const sheet = await screen.findByRole("dialog");
  expect(await within(sheet).findByText(`检查 ${job.id}`)).toBeTruthy();
  fireEvent.keyDown(sheet, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "切换任务辅助栏" }),
    ),
  );
  expect(
    calls.mock.calls.filter(([name]) => name === "app_workbench_update"),
  ).toHaveLength(0);
});
it("辅助关闭保存公共 auxiliary，布局与对象不被覆盖", async () => {
  const { snapshot } = mockShellIpc(undefined, {
    objects: [job],
    activeObject: job,
    auxiliary: { width: 400, visible: true, panel: "inspector" },
  });
  renderShell({}, `/devtools/jobs/${job.id}`);
  fireEvent.click(await screen.findByRole("button", { name: "关闭辅助栏" }));
  await waitFor(() => expect(snapshot().auxiliary.visible).toBe(false));
  expect(snapshot().auxiliary.width).toBe(400);
  expect(snapshot().objects).toEqual([job]);
});
it("panel 贡献必须唯一，并同时核验对象与面板的模块和权限", () => {
  expect(() => panelContributions([manifest, manifest])).toThrow("duplicate");
  const panels = panelContributions([manifest]);
  const objects = objectContributions([manifest]);
  expect(
    accessiblePanels(panels, objects, new Set(["devtools"]), visibility),
  ).toHaveLength(1);
  expect(accessiblePanels(panels, objects, new Set(), visibility)).toEqual([]);
  expect(
    accessiblePanels(panels, objects, new Set(["devtools"]), {
      ...visibility,
      permissions: [],
    }),
  ).toEqual([]);
});
it("Zen 进入与退出只影响当前会话", async () => {
  const { calls } = mockShellIpc();
  renderShell();
  fireEvent.click(await screen.findByRole("button", { name: "搜索命令" }));
  fireEvent.click(await screen.findByRole("option", { name: "进入专注模式" }));
  const exit = await screen.findByRole("button", { name: "退出专注模式" });
  fireEvent.click(exit);
  await screen.findByRole("button", { name: "搜索命令" });
  expect(
    calls.mock.calls.filter(([name]) => name === "app_workbench_update"),
  ).toHaveLength(0);
});

it("Zen 保持正文挂载，先让浮层处理 Escape，再由退出按钮处理", async () => {
  const { calls } = mockShellIpc();
  renderShell();
  await screen.findByRole("main");
  const main = screen.getByRole("main");
  fireEvent.click(screen.getByRole("button", { name: "搜索命令" }));
  fireEvent.click(await screen.findByRole("option", { name: "进入专注模式" }));
  const exit = await screen.findByRole("button", { name: "退出专注模式" });
  expect(screen.getByRole("main")).toBe(main);
  function Overlay() {
    const [open, setOpen] = useState(true);
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>验证浮层</DialogTitle>
          <button type="button">浮层按钮</button>
        </DialogContent>
      </Dialog>
    );
  }
  render(<Overlay />);
  fireEvent.keyDown(await screen.findByRole("button", { name: "浮层按钮" }), {
    key: "Escape",
    code: "Escape",
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "退出专注模式" })).toBe(exit);
  fireEvent.keyDown(exit, { key: "Escape", code: "Escape" });
  await screen.findByRole("button", { name: "搜索命令" });
  expect(screen.getByRole("main")).toBe(main);
  expect(
    calls.mock.calls.filter(([name]) => name === "app_workbench_update"),
  ).toHaveLength(0);
});

it("恢复的未知面板只报告数量，不把名称回显", async () => {
  const sentinel = "private-removed-provider";
  const { snapshot } = mockShellIpc(undefined, {
    auxiliary: { width: 320, visible: true, panel: sentinel },
  });
  const view = renderShell();
  await waitFor(() => expect(snapshot().auxiliary.panel).toBeNull());
  expect(document.body.textContent).not.toContain("private-removed-provider");
  expect(view.container.textContent).not.toContain(sentinel);
  expect(screen.getByText("已移除 1 个不可用面板选择")).toBeTruthy();
});
