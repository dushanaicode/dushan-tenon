import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { getSnapshot } from "@/core/appearance-bridge";
import { mockAppIpc, renderApp } from "./settings.test-support";

test("外观仅提供明暗模式，成功后即时更新外观桥且没有草稿", async () => {
  const calls = mockAppIpc();
  renderApp("/settings/appearance");
  const mode = await screen.findByRole("combobox", { name: "明暗模式" });
  fireEvent.click(mode);
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["浅色", "深色", "跟随系统"]);
  fireEvent.click(screen.getByRole("option", { name: "深色" }));
  await waitFor(() => expect(getSnapshot().mode).toBe("dark"));
  expect(calls).toHaveBeenCalledWith("app_settings_update", {
    input: { theme: "dark" },
  });
  expect(screen.queryByRole("region", { name: "未应用的更改" })).toBeNull();
  expect(screen.queryByRole("tablist")).toBeNull();
});

test.each(["environment", "commandLine"] as const)(
  "模式由 %s 固定时只读",
  async (source) => {
    const calls = mockAppIpc(undefined, { theme: { value: "dark", source } });
    renderApp("/settings/appearance");
    expect(
      await screen.findByRole("combobox", { name: "明暗模式" }),
    ).toHaveProperty("disabled", true);
    expect(
      calls.mock.calls.some(([name]) => name === "app_settings_update"),
    ).toBe(false);
  },
);

test("模式提交失败保留宿主事实并展示错误", async () => {
  const calls = mockAppIpc((name) =>
    name === "app_settings_update"
      ? Promise.reject({
          code: "app.config.write_failed",
          params: {},
          traceId: "mode-failed",
        })
      : undefined,
  );
  renderApp("/settings/appearance");
  fireEvent.click(await screen.findByRole("combobox", { name: "明暗模式" }));
  fireEvent.click(screen.getByRole("option", { name: "深色" }));
  await screen.findByText(/mode-failed/);
  expect(getSnapshot().mode).toBe("system");
  expect(
    calls.mock.calls.filter(([name]) => name === "app_settings_update"),
  ).toHaveLength(1);
});

test("系统标题栏放在通用，即时提交且不创建外观草稿", async () => {
  const calls = mockAppIpc();
  const { router } = renderApp("/settings/general");
  const titlebar = await screen.findByRole("switch", { name: "系统标题栏" });
  fireEvent.click(titlebar);
  await waitFor(() =>
    expect(titlebar.getAttribute("aria-checked")).toBe("false"),
  );
  expect(calls).toHaveBeenCalledWith("app_settings_update", {
    input: { titlebar: "hidden" },
  });
  await act(async () => {
    await router.navigate("/settings/appearance");
  });
  expect(screen.queryByRole("switch", { name: "系统标题栏" })).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
