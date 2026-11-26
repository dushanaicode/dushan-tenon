import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { getSnapshot } from "@/core/appearance-bridge";
import { mockAppIpc, renderApp } from "./settings.test-support";

test("明暗模式成功后即时更新外观桥且没有草稿", async () => {
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

test("主题卡片是单选组，选中后立即保存并切换外观桥", async () => {
  const calls = mockAppIpc();
  renderApp("/settings/appearance");
  const group = await screen.findByRole("radiogroup", { name: "主题" });
  const radios = within(group).getAllByRole("radio");
  expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
    "standard",
    "ink",
    "cyber",
  ]);
  expect(within(group).getByRole("radio", { name: /标准/ })).toHaveProperty(
    "checked",
    true,
  );
  fireEvent.click(within(group).getByRole("radio", { name: /水墨/ }));
  await waitFor(() => expect(getSnapshot().style).toBe("ink"));
  expect(calls).toHaveBeenCalledWith("app_settings_update", {
    input: { themeStyle: "ink" },
  });
  expect(within(group).getByRole("radio", { name: /水墨/ })).toHaveProperty(
    "checked",
    true,
  );
  expect(screen.queryByRole("region", { name: "未应用的更改" })).toBeNull();
});

test("强调色只在标准主题可选", async () => {
  const calls = mockAppIpc();
  renderApp("/settings/appearance");
  const accent = await screen.findByRole("combobox", { name: "强调色" });
  expect(accent).toHaveProperty("disabled", false);
  fireEvent.click(accent);
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["中性", "天蓝", "紫罗兰", "翠绿", "琥珀", "玫瑰"]);
  fireEvent.click(screen.getByRole("option", { name: "琥珀" }));
  await waitFor(() => expect(getSnapshot().accent).toBe("amber"));
  expect(calls).toHaveBeenCalledWith("app_settings_update", {
    input: { accent: "amber" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /赛博/ }));
  await waitFor(() => expect(getSnapshot().style).toBe("cyber"));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "强调色" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
});

test("主题由命令行固定时卡片只读", async () => {
  const calls = mockAppIpc(undefined, {
    themeStyle: { value: "cyber", source: "commandLine" },
  });
  renderApp("/settings/appearance");
  const group = await screen.findByRole("radiogroup", { name: "主题" });
  for (const radio of within(group).getAllByRole("radio"))
    expect(radio).toHaveProperty("disabled", true);
  expect(within(group).getByRole("radio", { name: /赛博/ })).toHaveProperty(
    "checked",
    true,
  );
  expect(
    calls.mock.calls.some(([name]) => name === "app_settings_update"),
  ).toBe(false);
});

test("密度与动效立即保存并更新外观桥", async () => {
  const calls = mockAppIpc();
  renderApp("/settings/appearance");
  fireEvent.click(await screen.findByRole("combobox", { name: "密度" }));
  fireEvent.click(screen.getByRole("option", { name: "紧凑" }));
  await waitFor(() => expect(getSnapshot().density).toBe("compact"));
  expect(calls).toHaveBeenCalledWith("app_settings_update", {
    input: { density: "compact" },
  });
  const motion = screen.getByRole("switch", { name: "动效" });
  expect(motion.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(motion);
  await waitFor(() => expect(getSnapshot().motion).toBe(false));
  expect(calls).toHaveBeenCalledWith("app_settings_update", {
    input: { motion: false },
  });
});
