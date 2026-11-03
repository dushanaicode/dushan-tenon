import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ConfigSource } from "@/lib/generated/ConfigSource";
import {
  mockAppIpc,
  mockDeveloperIpc,
  queryWrapper,
} from "../core.test-support";
import { SettingSelect } from "./setting-select";

function mount(source: ConfigSource, locked = false) {
  const onValueChange = vi.fn();
  const { wrapper } = queryWrapper();
  render(
    <SettingSelect
      label="Mode"
      value="light"
      source={source}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
      disabled={false}
      locked={locked}
      onValueChange={onValueChange}
    />,
    { wrapper },
  );
  return onValueChange;
}
it.each<[ConfigSource, string]>([
  ["environment", "由环境变量覆盖"],
  ["commandLine", "由命令行覆盖"],
])("locks %s even when caller has not disabled the control", (source, text) => {
  mockAppIpc();
  const change = mount(source);
  const select = screen.getByRole("combobox", { name: "Mode" });
  expect(select).toHaveProperty("disabled", true);
  expect(screen.getByText(text)).toBeTruthy();
  fireEvent.click(select);
  expect(change).not.toHaveBeenCalled();
});
it("locks explicitly restricted settings and keeps their reason visible", () => {
  mockAppIpc();
  mount("file", true);
  expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
});
it.each([false, true])(
  "shows ordinary source only in developer mode=%s",
  async (developer) => {
    if (developer) mockDeveloperIpc();
    else mockAppIpc();
    mount("file");
    expect(screen.getByRole("combobox")).toHaveProperty("disabled", false);
    if (developer) await screen.findByText("来自配置文件");
    else
      await waitFor(() =>
        expect(screen.queryByText("来自配置文件")).toBeNull(),
      );
  },
);
