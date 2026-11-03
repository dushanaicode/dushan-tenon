import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import {
  currentUser,
  mockAppIpc,
  paramEntries,
} from "@/core/core.test-support";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { PERMISSION_KEYS } from "@/lib/generated/permissions";
import type { SettingSetInput } from "@/lib/generated/SettingSetInput";
import {
  accountName,
  aiName,
  conflict,
  edit,
  listKey,
  mount,
  row,
  stored,
} from "./param-form.test-support";

test("account parameter reload refreshes the authentication readout", async () => {
  let minutes = 15;
  const entry = { ...paramEntries[0] };
  mockAppIpc((command) => {
    if (command === "app_setting_list") return [{ ...entry }];
    if (command === "app_setting_set") throw conflict();
    if (command === "account_auth_status")
      return {
        mode: "none",
        state: "active",
        user: currentUser,
        permissions: [...PERMISSION_KEYS],
        idleLockMinutes: minutes,
      };
  });
  const { client } = mount();
  await screen.findByRole("form", { name: accountName });
  edit(accountName, "20");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText("1 项保存失败");
  expect(client.getQueryData<AuthStatus>(authKey)?.idleLockMinutes).toBe(15);
  minutes = 30;
  entry.value = "30";
  fireEvent.click(row(accountName).getByRole("button", { name: "重新载入" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "重新载入",
    }),
  );
  await waitFor(() =>
    expect(client.getQueryData<AuthStatus>(authKey)?.idleLockMinutes).toBe(30),
  );
  await waitFor(() =>
    expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "30"),
  );
});

test("parameter conflict keeps draft and base version", async () => {
  const entries = structuredClone(paramEntries);
  entries[0] = stored(entries[0], "15", 3);
  let writes = 0;
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_setting_list") return structuredClone(entries);
    if (command === "app_setting_set") {
      const { input } = payload as { input: SettingSetInput };
      if (input.key !== entries[0].key) {
        const index = entries.findIndex((entry) => entry.key === input.key);
        entries[index] = stored(entries[index], input.value, 1);
        return structuredClone(entries[index]);
      }
      writes += 1;
      if (writes === 1) {
        entries[0] = stored(entries[0], "30", 4);
        throw conflict();
      }
      entries[0] = stored(entries[0], input.value, 5);
      return structuredClone(entries[0]);
    }
  });
  const { client } = mount();
  await screen.findByRole("form", { name: accountName });
  edit(accountName, "20");
  edit(aiName, "50");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await row(accountName).findByText(/草稿和编辑起点版本已保留/);
  await waitFor(() =>
    expect(client.getQueryData<ParamEntry[]>(listKey)?.[0].rowVersion).toBe(4),
  );
  await waitFor(() =>
    expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "20"),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "应用" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
  expect(writes).toBe(1);
  expect(calls).toHaveBeenCalledWith("app_setting_set", {
    input: { key: entries[0].key, value: "20", rowVersion: 3 },
  });
  expect(screen.getByRole("button", { name: "应用" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(row(accountName).getByRole("button", { name: "重新载入" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "取消",
    }),
  );
  expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "20");
  fireEvent.click(row(accountName).getByRole("button", { name: "重新载入" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "重新载入",
    }),
  );
  await waitFor(() =>
    expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "30"),
  );
  expect(row(aiName).getByRole("textbox")).toHaveProperty("value", "50");
  edit(accountName, "35");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "设置操作" })).toBeNull(),
  );
  expect(calls).toHaveBeenCalledWith("app_setting_set", {
    input: { key: entries[0].key, value: "35", rowVersion: 4 },
  });
  expect(writes).toBe(2);
});

test("reload failure keeps confirmation and draft", async () => {
  let failReload = false;
  const calls = mockAppIpc((command) => {
    if (command === "app_setting_set") throw conflict();
    if (command === "app_setting_list") {
      if (failReload)
        throw {
          code: "app.internal.unexpected",
          params: {},
          traceId: "param-reload",
        };
      return structuredClone(paramEntries);
    }
  });
  mount();
  await screen.findByRole("form", { name: accountName });
  edit(accountName, "20");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await row(accountName).findByText(/草稿和编辑起点版本已保留/);
  const input = row(accountName).getByRole("textbox");
  fireEvent.click(row(accountName).getByRole("button", { name: "重新载入" }));
  const dialog = await screen.findByRole("alertdialog");
  const confirm = within(dialog).getByRole("button", { name: "重新载入" });
  const previousReads = calls.mock.calls.filter(
    ([name]) => name === "app_setting_list",
  ).length;
  failReload = true;
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await within(dialog).findByText(/param-reload/);
  expect(screen.getByRole("alertdialog")).toBe(dialog);
  expect(input).toHaveProperty("value", "20");
  await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
  expect(
    calls.mock.calls.filter(([name]) => name === "app_setting_list"),
  ).toHaveLength(previousReads + 1);
  failReload = false;
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "15");
});

test("background refresh preserves a null edit version", async () => {
  const entries = structuredClone(paramEntries);
  const calls = mockAppIpc((command) => {
    if (command === "app_setting_list") return structuredClone(entries);
    if (command === "app_setting_set") throw conflict();
  });
  const { client } = mount();
  await screen.findByRole("form", { name: accountName });
  edit(accountName, "20");
  entries[0] = stored(entries[0], "30", 1);
  await act(async () => {
    await client.invalidateQueries({ queryKey: listKey });
  });
  await waitFor(() =>
    expect(client.getQueryData<ParamEntry[]>(listKey)?.[0].rowVersion).toBe(1),
  );
  await waitFor(() =>
    expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "20"),
  );
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await row(accountName).findByText(/草稿和编辑起点版本已保留/);
  expect(calls).toHaveBeenCalledWith("app_setting_set", {
    input: { key: entries[0].key, value: "20", rowVersion: null },
  });
  expect(
    calls.mock.calls.filter(([name]) => name === "app_setting_set"),
  ).toHaveLength(1);
});

test("cache failure keeps the draft and refreshes facts", async () => {
  const entries = structuredClone(paramEntries);
  entries[0] = stored(entries[0], "15", 3);
  let writes = 0;
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_setting_list") return structuredClone(entries);
    if (command === "app_setting_set") {
      const { input } = payload as { input: SettingSetInput };
      writes += 1;
      if (writes === 1) {
        entries[0] = stored(entries[0], input.value, 4);
        throw {
          code: "app.cache.unavailable",
          params: {},
          traceId: "after-commit",
        };
      }
      throw conflict();
    }
  });
  const { client } = mount();
  await screen.findByRole("form", { name: accountName });
  edit(accountName, "20");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText("1 项保存失败");
  expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "20");
  expect(client.getQueryData<ParamEntry[]>(listKey)?.[0].rowVersion).toBe(4);
  expect(writes).toBe(1);
  edit(accountName, "21");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await row(accountName).findByText(/草稿和编辑起点版本已保留/);
  expect(calls).toHaveBeenCalledWith("app_setting_set", {
    input: { key: entries[0].key, value: "21", rowVersion: 3 },
  });
});
