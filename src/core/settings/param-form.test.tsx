import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { mockAppIpc, paramEntries } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import {
  accountName,
  edit,
  listKey,
  mockSampleIpc,
  mount,
  row,
  sampleFixture,
  sampleName,
  stored,
} from "./param-form.test-support";

test.each([false, true])(
  "all parameter groups keep titles with includeDisabled=%s",
  async (includeDisabled) => {
    mockSampleIpc((command) =>
      command === "app_modules_list"
        ? {
            modules: sampleFixture.modules.modules.map((module) => ({
              ...module,
              enabled:
                module.id === "sample" ? !includeDisabled : module.enabled,
            })),
          }
        : undefined,
    );
    mount(includeDisabled);
    await screen.findByRole("form", { name: accountName });
    for (const [title, name] of [
      ["账号安全", accountName],
      ["样板参数", sampleName],
      ["通知偏好", "提示位置"],
    ]) {
      expect(screen.getAllByText(title)).toHaveLength(1);
      expect(
        within(screen.getByRole("group", { name: title })).getByRole("form", {
          name,
        }),
      ).toBeTruthy();
    }
  },
);

test("parameter reset uses row existence", async () => {
  const entries = structuredClone(paramEntries);
  entries[0] = stored(entries[0], "15", 7);
  let resolveReset!: (entry: ParamEntry) => void;
  const reset = new Promise<ParamEntry>((resolve) => {
    resolveReset = resolve;
  });
  let resolveSave!: (entry: ParamEntry) => void;
  const save = new Promise<ParamEntry>((resolve) => {
    resolveSave = resolve;
  });
  const calls = mockAppIpc((command) => {
    if (command === "app_setting_list") return structuredClone(entries);
    if (command === "app_setting_reset") return reset;
    if (command === "app_setting_set") return save;
  });
  const { client } = mount();
  await screen.findByRole("form", { name: accountName });
  expect(row(accountName).getByRole("button", { name: "重置" })).toHaveProperty(
    "disabled",
    false,
  );
  edit(accountName, "16");
  fireEvent.click(row(accountName).getByRole("button", { name: "重置" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "重置",
    }),
  );
  await screen.findByText("正在保存…");
  expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "16");
  expect(client.getQueryData<ParamEntry[]>(listKey)?.[0].rowVersion).toBe(7);
  entries[0] = { ...paramEntries[0] };
  await act(async () => resolveReset(structuredClone(entries[0])));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "设置操作" })).toBeNull(),
  );
  expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "15");
  expect(row(accountName).getByRole("button", { name: "重置" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(calls).toHaveBeenCalledWith("app_setting_reset", {
    input: { key: entries[0].key, rowVersion: 7 },
  });
  for (const value of ["", "1.5", "abc", "1.", "9007199254740992"]) {
    edit(accountName, value);
    fireEvent.blur(row(accountName).getByRole("textbox"));
    expect(row(accountName).getByRole("textbox")).toHaveProperty(
      "value",
      value,
    );
    expect(screen.getByRole("button", { name: "应用" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.submit(screen.getByRole("form", { name: accountName }));
  }
  expect(
    calls.mock.calls.filter(([name]) => name === "app_setting_set"),
  ).toHaveLength(0);
  edit(accountName, "16");
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText("正在保存…");
  expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "16");
  expect(client.getQueryData<ParamEntry[]>(listKey)?.[0].value).toBe("15");
  entries[0] = stored(entries[0], "16", 1);
  await act(async () => resolveSave(structuredClone(entries[0])));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "设置操作" })).toBeNull(),
  );
  entries[0] = stored(entries[0], "17", 2);
  await act(async () => {
    await client.invalidateQueries({ queryKey: listKey });
  });
  await waitFor(() =>
    expect(row(accountName).getByRole("textbox")).toHaveProperty("value", "17"),
  );
});

test.each(
  [
    ["sample.test_text", "next"],
    ["notify.quiet_enabled", "true"],
    ["notify.toast_position", "bottom-left"],
    ["sample.test_secret", "synthetic-password"],
  ].map(([key, next]) => {
    const [entry] = sampleFixture.params.filter((entry) => entry.key === key);
    return [entry.kind, entry, next] as const;
  }),
)("parameter scalar editor handles %j", async (kind, fixture, next) => {
  let entry = structuredClone(fixture);
  const name = i18n.t(`param.${entry.key}.name`);
  let finish!: (entry: ParamEntry) => void;
  const pending = new Promise<ParamEntry>((resolve) => {
    finish = resolve;
  });
  const calls = mockSampleIpc((command) => {
    if (command === "app_setting_list") return [structuredClone(entry)];
    if (command === "app_setting_set") return pending;
  });
  const { client, unmount } = mount();
  await screen.findByRole("form", { name });
  if (kind.type === "boolean") {
    fireEvent.click(row(name).getByRole("switch"));
  } else if (kind.type === "choice") {
    fireEvent.pointerDown(row(name).getByRole("combobox"), {
      button: 0,
      pointerType: "mouse",
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByRole("option", {
        name: i18n.t(`param.${entry.key}.choice.${next}`),
      }),
    );
  } else {
    fireEvent.change(row(name).getByLabelText(name), {
      target: { value: next },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText("正在保存…");
  expect(calls).toHaveBeenCalledWith("app_setting_set", {
    input: { key: entry.key, value: next, rowVersion: null },
  });
  if (kind.type === "secret") {
    const states = client
      .getMutationCache()
      .getAll()
      .map((m) => m.state);
    expect(JSON.stringify(states)).not.toContain(next);
    expect(JSON.stringify(client.getQueryData(listKey))).not.toContain(next);
  }
  entry = {
    ...stored(entry, next, 1),
    value: kind.type === "secret" ? null : next,
    secretSet: kind.type === "secret",
    isDefault: false,
  };
  await act(async () => finish(structuredClone(entry)));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "设置操作" })).toBeNull(),
  );
  if (kind.type === "secret") {
    expect(row(name).getByLabelText(name)).toHaveProperty("value", "");
  }
  unmount();
});
