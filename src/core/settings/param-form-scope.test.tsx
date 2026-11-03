import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import {
  appModules,
  currentUser,
  mockAppIpc,
  paramEntries,
} from "@/core/core.test-support";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { PERMISSION_KEYS } from "@/lib/generated/permissions";
import type { SettingSetInput } from "@/lib/generated/SettingSetInput";
import {
  accountName,
  demoName,
  edit,
  listKey,
  mount,
  row,
  stored,
} from "./param-form.test-support";

test("parameter list honours read and write grants", async () => {
  let permissions: string[] = [];
  let modules = structuredClone(appModules);
  const calls = mockAppIpc((command) => {
    if (command === "account_auth_status") {
      return {
        state: "active",
        mode: "none",
        user: currentUser,
        permissions,
        idleLockMinutes: 15,
      };
    }
    if (command === "app_modules_list") return modules;
  });
  const { client } = mount(true);
  await screen.findByRole("form", { name: accountName });
  expect(screen.queryByRole("form", { name: demoName })).toBeNull();
  expect(row(accountName).getByRole("textbox")).toHaveProperty(
    "disabled",
    true,
  );
  expect(row(accountName).getByText(/需要“管理账号安全设置”权限/)).toBeTruthy();
  permissions = ["demo.settings.manage"];
  await act(async () => {
    await client.invalidateQueries({ queryKey: authKey });
  });
  await screen.findByRole("form", { name: demoName });
  expect(row(demoName).getByRole("textbox")).toHaveProperty("disabled", false);
  permissions = [...PERMISSION_KEYS];
  modules = {
    modules: appModules.modules.map((module) => ({
      ...module,
      enabled: module.id !== "demo",
    })),
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["app", "modules"] });
    await client.invalidateQueries({ queryKey: authKey });
  });
  await waitFor(() =>
    expect(row(demoName).getByRole("textbox")).toHaveProperty("disabled", true),
  );
  expect(
    await row(demoName).findByText("所属模块已停用，此设置只读。"),
  ).toBeTruthy();
  expect(row(accountName).getByRole("textbox")).toHaveProperty(
    "disabled",
    false,
  );
  edit(accountName, "20");
  permissions = [];
  await act(async () => {
    await client.invalidateQueries({ queryKey: authKey });
  });
  await waitFor(() => {
    expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "15");
    expect(screen.queryByRole("form", { name: demoName })).toBeNull();
  });
  expect(calls).toHaveBeenCalledWith("app_setting_list", {
    input: { includeDisabled: true },
  });
  expect(
    calls.mock.calls.filter(([name]) => name === "app_setting_set"),
  ).toHaveLength(0);
});

test("identity changes clear drafts and isolate queries", async () => {
  let user = currentUser;
  let state = "active";
  const calls = mockAppIpc((command) => {
    if (command === "account_auth_status") {
      return {
        state,
        mode: "none",
        user: state === "active" ? user : null,
        permissions: [...PERMISSION_KEYS],
        idleLockMinutes: 15,
      };
    }
  });
  const { client } = mount();
  await screen.findByRole("form", { name: accountName });
  edit(accountName, "20");
  user = { ...currentUser, id: "01999000-1234-7000-8000-123456789abd" };
  await act(async () => {
    await client.invalidateQueries({ queryKey: authKey });
  });
  await waitFor(() => {
    expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "15");
    expect(client.getQueryData(listKey)).toBeUndefined();
  });
  expect(client.getQueryData(["app", "setting", user.id, false])).toBeTruthy();
  state = "anonymous";
  await act(async () => {
    await client.invalidateQueries({ queryKey: authKey });
  });
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: accountName })).toBeNull(),
  );
  expect(
    calls.mock.calls.filter(([name]) => name === "app_setting_set"),
  ).toHaveLength(0);
});

test("apply saves keys sequentially and invalidates user lists", async () => {
  const entries = structuredClone(paramEntries);
  const demoIndex = entries.findIndex(({ key }) => key === "demo.batch_size");
  let finish!: (entry: ParamEntry) => void;
  const pending = new Promise<ParamEntry>((resolve) => {
    finish = resolve;
  });
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_setting_list") return structuredClone(entries);
    if (command === "app_setting_set") {
      const { input } = payload as { input: SettingSetInput };
      if (input.key === entries[0].key) return pending;
      entries[demoIndex] = stored(entries[demoIndex], input.value, 1);
      return structuredClone(entries[demoIndex]);
    }
  });
  const { client } = mount();
  await screen.findByRole("form", { name: accountName });
  const inspectKey = ["app", "setting", currentUser.id, true];
  client.setQueryData(inspectKey, structuredClone(entries));
  edit(accountName, "20");
  edit(demoName, "50");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText("正在保存…");
  expect(screen.getByRole("button", { name: "应用" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    calls.mock.calls.filter(([name]) => name === "app_setting_set"),
  ).toHaveLength(1);
  expect(screen.getByText("正在保存…")).toBeTruthy();
  const mutations = client.getMutationCache().getAll();
  for (const mutation of mutations) {
    expect(mutation.options.mutationKey?.slice(0, 3)).toEqual([
      "app",
      "setting",
      currentUser.id,
    ]);
    expect(mutation.options.scope?.id).toBe(
      `setting:${currentUser.id}:${mutation.options.mutationKey?.[3]}`,
    );
  }
  entries[0] = stored(entries[0], "20", 1);
  const authCalls = calls.mock.calls.filter(
    ([name]) => name === "account_auth_status",
  ).length;
  await act(async () => finish(structuredClone(entries[0])));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "设置操作" })).toBeNull(),
  );
  expect(client.getQueryData<ParamEntry[]>(inspectKey)?.[demoIndex].value).toBe(
    "50",
  );
  expect(client.getQueryState(inspectKey)?.isInvalidated).toBe(true);
  expect(
    calls.mock.calls.filter(([name]) => name === "account_auth_status").length,
  ).toBeGreaterThan(authCalls);
});
