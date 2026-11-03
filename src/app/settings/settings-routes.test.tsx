import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { activeAuth } from "@/core/core.test-support";
import { testManifest } from "@/core/module-directory.test-support";
import { mockAppIpc, renderApp } from "./settings.test-support";

test("默认入口重定向到首个可见分节，未知路径返回 404", async () => {
  mockAppIpc();
  const { router } = renderApp("/settings");
  await screen.findByRole("heading", { name: "通用" });
  expect(router.state.location.pathname).toBe("/settings/general");
  await act(async () => {
    await router.navigate("/settings/missing");
  });
  expect(await screen.findByText("404")).toBeTruthy();
});

test("split 选择器切换分节并与侧栏使用相同目录", async () => {
  mockAppIpc();
  const { router } = renderApp("/settings/appearance");
  const selector = await screen.findByRole("combobox", { name: "设置" });
  fireEvent.click(selector);
  fireEvent.click(screen.getByRole("option", { name: "关于" }));
  await screen.findByText("0.1.0-alpha.1");
  expect(router.state.location.pathname).toBe("/settings/about");
  expect(
    within(screen.getByRole("navigation", { name: "设置" }))
      .getByRole("link", { name: "关于" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(screen.queryByRole("tablist")).toBeNull();
});

test.each(["disabled", "permission", "authMode", "developer"] as const)(
  "模块分节的 %s 门控同时作用于路由与导航",
  async (kind) => {
    const factory = vi.fn(async () => ({ default: () => <p>模块内容</p> }));
    const manifest = testManifest({
      settings: [
        {
          id: "custom",
          labelKey: "自定义",
          order: 40,
          Component: factory,
          ...(kind === "permission"
            ? { permission: "devtools.job.read" as const }
            : {}),
          ...(kind === "authMode" ? { authMode: "login" as const } : {}),
          ...(kind === "developer" ? { developerOnly: true as const } : {}),
        },
      ],
    });
    mockAppIpc((name) =>
      name === "account_auth_status"
        ? { ...activeAuth, permissions: [] }
        : name === "app_modules_list" && kind === "disabled"
          ? { modules: [{ id: "devtools", enabled: false }] }
          : undefined,
    );
    renderApp("/settings/custom", [manifest]);
    expect(
      await screen.findByText(
        kind === "disabled" || kind === "developer" ? "404" : "403",
      ),
    ).toBeTruthy();
    expect(factory).not.toHaveBeenCalled();
  },
);

test.each(["app_modules_list", "app_setting_list"])(
  "目录保留 %s 初次 pending 与错误",
  async (command) => {
    let reject: (error: unknown) => void = () => {
      throw new Error("not started");
    };
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    mockAppIpc((name) => (name === command ? pending : undefined));
    renderApp("/settings/general");
    await screen.findByText("正在加载设置…");
    await act(async () => {
      reject({
        code: "app.cache.unavailable",
        params: {},
        traceId: "directory-failed",
      });
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "directory-failed",
    );
    expect(screen.queryByRole("heading", { name: "通用" })).toBeNull();
  },
);

test("参数草稿跨分节保留，动作栏保持实例，离开设置要确认", async () => {
  mockAppIpc();
  const { router } = renderApp("/settings/param.account.security");
  const editor = await screen.findByRole("textbox", {
    name: "空闲自动锁定（分钟）",
  });
  fireEvent.change(editor, { target: { value: "25" } });
  const actions = screen.getByRole("region", { name: "设置操作" });
  await act(async () => {
    await router.navigate("/settings/appearance");
  });
  expect(screen.getByRole("region", { name: "设置操作" })).toBe(actions);
  const navigation = screen.getByRole("navigation", { name: "设置" });
  expect(
    within(navigation).getByRole("img", { name: "有未应用的更改" }),
  ).toBeTruthy();
  await act(async () => {
    await router.navigate("/settings/param.account.security");
  });
  expect(
    await screen.findByRole("textbox", { name: "空闲自动锁定（分钟）" }),
  ).toHaveProperty("value", "25");
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "继续编辑" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "放弃修改",
    }),
  );
  await screen.findByText("首页内容");
});

test("权限改变重新获取参数，未改变不重复读取", async () => {
  let permissions = activeAuth.permissions;
  const calls = mockAppIpc((name) =>
    name === "account_auth_status" ? { ...activeAuth, permissions } : undefined,
  );
  const { client } = renderApp("/settings/appearance");
  await screen.findByRole("combobox", { name: "外观" });
  const count = () =>
    calls.mock.calls.filter(([name]) => name === "app_setting_list").length;
  const first = count();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["account", "auth"] });
  });
  expect(count()).toBe(first);
  permissions = [];
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["account", "auth"] });
  });
  await waitFor(() => expect(count()).toBe(first + 1));
});
