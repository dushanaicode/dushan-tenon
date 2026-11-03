import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { assert, expect, test } from "vitest";
import { currentUser } from "@/core/core.test-support";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import type { SettingSetInput } from "@/lib/generated/SettingSetInput";
import { demoParamEntries, mockDemoIpc, renderDemo } from "./demo.test-support";

test("settings embeds the declared demo.work parameter contract", async () => {
  const parameters = structuredClone(demoParamEntries);
  const calls = mockDemoIpc((command, payload) => {
    if (command === "app_setting_list") return structuredClone(parameters);
    if (command === "app_setting_set") {
      const { input } = payload as { input: SettingSetInput };
      const entry = parameters.find(({ key }) => key === input.key);
      assert(entry);
      Object.assign(entry, {
        value: input.value,
        rowVersion: 1,
        isDefault: false,
        source: "database",
        updatedAt: "2026-10-20T00:00:00.000Z",
      } satisfies Partial<ParamEntry>);
      return structuredClone(entry);
    }
  });
  renderDemo("/settings/demo");
  const form = await screen.findByRole("form", { name: "测量批次大小" });
  const input = within(form).getByRole("textbox");
  expect(input).toHaveProperty("value", "25");
  fireEvent.change(input, { target: { value: "40" } });
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([command]) => command === "app_setting_set"),
    ).toEqual([
      [
        "app_setting_set",
        { input: { key: "demo.batch_size", value: "40", rowVersion: null } },
      ],
    ]),
  );
  expect(screen.queryByRole("form", { name: "自动锁定时间" })).toBeNull();
});

test("settings requires its permission while developer mode is enabled", async () => {
  const calls = mockDemoIpc((command) =>
    command === "account_auth_status"
      ? {
          mode: "none",
          state: "active",
          user: currentUser,
          permissions: ["demo.sample.read"],
          idleLockMinutes: 15,
        }
      : undefined,
  );
  renderDemo("/settings/demo");
  await screen.findByText("没有权限");
  expect(screen.queryByRole("form", { name: "测量批次大小" })).toBeNull();
  expect(
    calls.mock.calls.some(([command]) => command === "app_setting_set"),
  ).toBe(false);
});

test("settings unmounts its parameter editor when developer mode is disabled", async () => {
  mockDemoIpc(undefined, { developerMode: { value: false, source: "file" } });
  renderDemo("/settings/demo");
  await screen.findByText("页面不存在");
  expect(screen.queryByRole("form", { name: "测量批次大小" })).toBeNull();
});
