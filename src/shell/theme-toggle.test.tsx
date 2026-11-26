import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { applyAppearance, getSnapshot } from "@/core/appearance-bridge";
import {
  defaultSettings,
  mockAppIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { ThemeToggle } from "./theme-toggle";

it("主题切换复用 core mutation，成功后读取外观桥的明暗", async () => {
  const calls = mockAppIpc();
  render(<ThemeToggle />, { wrapper: queryWrapper().wrapper });
  fireEvent.click(await screen.findByRole("button", { name: "切换到深色" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_settings_update", {
      input: { theme: "dark" },
    }),
  );
  await screen.findByRole("button", { name: "切换到浅色" });
});
it.each(["environment", "commandLine"] as const)(
  "%s 来源固定时禁用切换",
  async (source) => {
    mockAppIpc(undefined, { theme: { ...defaultSettings.theme, source } });
    applyAppearance({ ...getSnapshot(), mode: "light" });
    render(<ThemeToggle />, { wrapper: queryWrapper().wrapper });
    expect((await screen.findByRole("button")).hasAttribute("disabled")).toBe(
      true,
    );
  },
);
