import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { PageHeader } from "@/kit";
import { mockShellIpc, renderShell, resizeShell } from "../shell.test-support";

it("顶栏优先导航名，无导航时同步页面标题，无标题时留空", async () => {
  mockShellIpc();
  const view = renderShell({}, "/", <PageHeader title="首页正文" />);
  await screen.findByRole("button", { name: "收起侧栏" });
  const title = view.container.querySelector(
    '[data-shell="topbar"] [data-part="title"]',
  );
  expect(title?.textContent).toBe("首页");
  view.update({ tree: { groups: [], footer: [] } });
  expect(title?.textContent).toBe("首页正文");
  view.update({ children: <PageHeader title="个人资料" /> });
  expect(title?.textContent).toBe("个人资料");
  view.update({ children: null });
  expect(title?.textContent).toBe("");
});

it.each(["/notify", "/account/profile", "/missing", "/demo/details/42"])(
  "%s 没有导航匹配时显示 PageHeader 标题",
  async (path) => {
    mockShellIpc();
    const view = renderShell({}, path);
    await screen.findByRole("heading", { name: path });
    expect(
      view.container.querySelector('[data-shell="topbar"] [data-part="title"]')
        ?.textContent,
    ).toBe(path);
  },
);

it("主内容不受 Grid 行高限制，内容板保留满屏高度与自然增长", async () => {
  mockShellIpc();
  renderShell();
  const main = await screen.findByRole("main");
  expect(main.classList.contains("grid")).toBe(false);
  for (const token of ["@container/content", "h-full", "min-h-max"])
    expect(main.firstElementChild?.classList.contains(token)).toBe(true);
});

it("宽档侧栏、中档图标栏和窄档抽屉按容器切换；响应式不写宿主布局", async () => {
  const { calls } = mockShellIpc();
  const view = renderShell();
  await screen.findByRole("button", { name: "收起侧栏" });
  const root = view.container.querySelector('[data-shell="root"]');
  expect(root?.getAttribute("data-shell-tier")).toBe("expanded");
  resizeShell(900);
  expect(root?.getAttribute("data-shell-tier")).toBe("medium");
  fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
  expect(screen.getByRole("button", { name: "收起侧栏" })).toBeTruthy();
  expect(
    calls.mock.calls.filter(([name]) => name === "app_workbench_update"),
  ).toHaveLength(0);
  resizeShell(600);
  fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "打开导航" }),
    ),
  );
});
it("抽屉选页后聚焦正文 h1；宽档手动收起会持久化", async () => {
  const { snapshot } = mockShellIpc();
  renderShell();
  fireEvent.click(await screen.findByRole("button", { name: "收起侧栏" }));
  await waitFor(() =>
    expect(snapshot().layouts.console.primaryCollapsed).toBe(true),
  );
  resizeShell(600);
  fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("link", {
      name: "文件管理",
    }),
  );
  const title = await screen.findByRole("heading", { name: "/files" });
  await waitFor(() => expect(document.activeElement).toBe(title));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("命令面板选页聚焦 h1，区域焦点命令在浮层关闭后使用 ref", async () => {
  mockShellIpc();
  const view = renderShell();
  fireEvent.click(await screen.findByRole("button", { name: "搜索命令" }));
  fireEvent.click(await screen.findByRole("option", { name: "文件管理" }));
  const title = await screen.findByRole("heading", { name: "/files" });
  await waitFor(() => expect(document.activeElement).toBe(title));
  fireEvent.click(screen.getByRole("button", { name: "搜索命令" }));
  fireEvent.click(await screen.findByRole("option", { name: "聚焦主侧栏" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      view.container.querySelector("[data-workbench-primary]"),
    ),
  );
});
