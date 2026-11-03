import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { applyMode } from "@/core/appearance-bridge";
import { activeAuth } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import { toast } from "@/kit";
import { mockAppIpc, renderApp } from "./app.test-support";

test("首页装配真实导航、静态品牌及唯一 Toaster，主题与语言同步", async () => {
  const calls = mockAppIpc();
  const { container, client } = renderApp();
  await screen.findByRole("heading", { name: i18n.t("app.name") });
  const navigation = await screen.findByRole("navigation", { name: "主导航" });
  expect(
    within(navigation)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
  ).toEqual(["/", "/settings"]);
  act(() => {
    toast("integration-toast");
  });
  await screen.findByText("integration-toast");
  expect(container.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
  expect(container.querySelector('img[src="/brand/logo.svg"]')).toBeTruthy();
  expect(
    calls.mock.calls.filter(([command]) => command === "app_window_watch"),
  ).toHaveLength(1);
  expect(
    calls.mock.calls.filter(([command]) => command === "app_workbench_get"),
  ).toHaveLength(1);
  expect(
    calls.mock.calls.some(([command]) => command === "app_settings_get"),
  ).toBe(false);
  await act(async () => {
    applyMode("dark");
    await i18n.changeLanguage("en-US");
  });
  expect(document.documentElement.lang).toBe("en-US");
  expect(
    container
      .querySelector("[data-sonner-toaster]")
      ?.getAttribute("data-sonner-theme"),
  ).toBe("dark");
  expect(
    screen.getByRole("navigation", { name: "Main navigation" }),
  ).toBeTruthy();
  expect(client.getQueryData(["app", "settings"])).toBeTruthy();
});

test.each([
  ["anonymous", "native"],
  ["anonymous", "hidden"],
  ["locked", "native"],
  ["locked", "hidden"],
] as const)(
  "认证 %s、标题栏 %s 时保留独立顶栏，不挂载工作台和通知",
  async (state, titlebar) => {
    const calls = mockAppIpc((command) =>
      command === "account_auth_status"
        ? {
            ...activeAuth,
            mode: "login",
            state,
            user:
              state === "anonymous"
                ? null
                : { ...activeAuth.user, mode: "login" },
            permissions: [],
          }
        : undefined,
    );
    renderApp("/", { titlebar: { value: titlebar, source: "default" } });
    await screen.findByRole("heading", {
      name: state === "locked" ? "已锁定" : "登录",
    });
    const header = screen.getByRole("banner");
    expect(header.closest('[data-kit="scroll-area"]')).toBeNull();
    expect(
      within(header).getByRole("link", { name: i18n.t("app.name") }),
    ).toBeTruthy();
    const controls = within(header).queryByRole("group", {
      name: i18n.t("shell.window.controls"),
    });
    if (titlebar === "hidden") {
      expect(controls).toBeTruthy();
      expect(controls?.parentElement?.classList.contains("h-full")).toBe(true);
      expect(header.classList.contains("pr-0")).toBe(true);
    } else {
      expect(controls).toBeNull();
      expect(header.classList.contains("pr-6")).toBe(true);
    }
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();
    expect(
      calls.mock.calls.some(
        ([command]) =>
          command === "app_workbench_get" || command.startsWith("notify_"),
      ),
    ).toBe(false);
    expect(
      calls.mock.calls.filter(([command]) => command === "app_window_watch"),
    ).toHaveLength(1);
  },
);

test.each([
  "/unknown",
  "/styleguide",
  "/ai",
  "/account/users",
  "/Settings/general",
  "/NOTIFY",
])("未知及旧路径 %s 保持原路径并显示 404", async (path) => {
  mockAppIpc();
  const { router } = renderApp(path);
  await screen.findByRole("heading", { name: i18n.t("notFound.title") });
  expect(router.state.location.pathname).toBe(path);
  fireEvent.click(screen.getByRole("link", { name: i18n.t("notFound.home") }));
  await screen.findByRole("heading", { name: i18n.t("app.name") });
  expect(router.state.location.pathname).toBe("/");
});

test("设置首项在 Shell 内呈现，共享窗口和工作台实例", async () => {
  const calls = mockAppIpc();
  const { router } = renderApp("/settings");
  await screen.findByRole("heading", { name: "通用" });
  expect(router.state.location.pathname).toBe("/settings/general");
  await act(async () => {
    await router.navigate("/settings/appearance");
  });
  await screen.findByRole("combobox", {
    name: i18n.t("settings.appearance.colorMode"),
  });
  expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([command]) => command === "app_workbench_get"),
    ).toHaveLength(1),
  );
  expect(
    calls.mock.calls.filter(([command]) => command === "app_window_watch"),
  ).toHaveLength(1);
});

test("主题保存失败保持确认值并通过根 Toaster 呈现追踪信息", async () => {
  mockAppIpc((command) => {
    if (command === "app_settings_update")
      throw {
        code: "app.config.read_only",
        params: {},
        traceId: "theme-failed",
      };
  });
  const { client } = renderApp();
  const before = client.getQueryData(["app", "settings"]);
  fireEvent.click(await screen.findByRole("button", { name: "切换到深色" }));
  expect(await screen.findByText("追踪 ID：theme-failed")).toBeTruthy();
  expect(client.getQueryData(["app", "settings"])).toBe(before);
});
