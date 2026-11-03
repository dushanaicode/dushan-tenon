import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { mockAppIpc, renderApp } from "./settings.test-support";

test("通用设置按功能分组，窗口状态关联到几何恢复开关", async () => {
  mockAppIpc();
  renderApp("/settings/general");
  await screen.findByRole("group", { name: "应用内快捷键" });
  const restore = await screen.findByRole("switch", {
    name: "记住窗口位置和大小",
  });
  expect(
    screen
      .getAllByRole("group")
      .map(
        (group) =>
          group.getAttribute("aria-labelledby") &&
          document.getElementById(group.getAttribute("aria-labelledby") ?? "")
            ?.textContent,
      ),
  ).toEqual([
    "语言",
    "标题栏",
    "窗口",
    "托盘与关闭",
    "启动",
    "全局快捷键",
    "应用内快捷键",
  ]);
  const window = screen.getByRole("group", { name: "窗口" });
  expect(within(window).getByRole("switch")).toBe(restore);
  const description = document.getElementById(
    restore.getAttribute("aria-describedby") ?? "",
  );
  expect(description?.textContent).toContain("下次启动恢复窗口");
  expect(description?.textContent).toContain("本次启动未恢复窗口位置。");
  expect(
    within(window).getByRole("button", { name: "重置窗口位置" }),
  ).toBeTruthy();
});

test.each(["environment", "commandLine"] as const)(
  "通用页的语言、标题栏和高级选项遵守 %s 来源锁定",
  async (source) => {
    mockAppIpc(undefined, {
      language: { value: "zh-CN", source },
      titlebar: { value: "native", source },
      developerMode: { value: false, source },
      logLevel: { value: "info", source },
    });
    const { router } = renderApp("/settings/general");
    expect(
      await screen.findByRole("switch", { name: "系统标题栏" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox", { name: "界面语言" })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => {
      await router.navigate("/settings/advanced");
    });
    expect(
      await screen.findByRole("switch", { name: "开发者模式" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox", { name: "日志级别" })).toHaveProperty(
      "disabled",
      true,
    );
  },
);

test("标题栏保存失败保留确认值并展示错误", async () => {
  mockAppIpc((name) =>
    name === "app_settings_update"
      ? Promise.reject({
          code: "app.config.write_failed",
          params: {},
          traceId: "titlebar-failed",
        })
      : undefined,
  );
  renderApp("/settings/general");
  const toggle = await screen.findByRole("switch", { name: "系统标题栏" });
  fireEvent.click(toggle);
  await screen.findByText(/titlebar-failed/);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

test("高级页的日志和开发者模式直接保存", async () => {
  const calls = mockAppIpc();
  renderApp("/settings/advanced");
  fireEvent.click(await screen.findByRole("combobox", { name: "日志级别" }));
  fireEvent.click(screen.getByRole("option", { name: "调试" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_settings_update", {
      input: { logLevel: "debug" },
    }),
  );
  const developer = screen.getByRole("switch", { name: "开发者模式" });
  fireEvent.click(developer);
  await waitFor(() =>
    expect(developer.getAttribute("aria-checked")).toBe("true"),
  );
  expect(calls).toHaveBeenCalledWith("app_settings_update", {
    input: { developerMode: true },
  });
});
