import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { mockAppIpc, renderApp } from "./settings.test-support";

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
