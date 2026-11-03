import { act, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import {
  activeAuth,
  appModules,
  mockDeveloperIpc,
  paramEntries,
} from "@/core/core.test-support";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { renderDevtoolsPage } from "./devtools.test-support";

const base = paramEntries[0];
const entries: ParamEntry[] = [
  base,
  {
    ...base,
    key: "notify.test_disabled",
    moduleId: "notify",
    readPermission: "account.security.manage",
  },
  {
    ...base,
    key: "account.secret_set",
    effect: "nextJob",
    kind: { type: "secret" },
    value: "MUST_NOT_RENDER_VALUE",
    default: "MUST_NOT_RENDER_DEFAULT",
    secretSet: true,
    source: "database",
    rowVersion: 4,
  },
  {
    ...base,
    key: "account.secret_unset",
    kind: { type: "secret" },
    value: null,
    default: null,
    secretSet: false,
  },
];

function setup() {
  return mockDeveloperIpc((command, payload) => {
    if (command === "app_modules_list")
      return {
        modules: appModules.modules.map((module) => ({
          ...module,
          enabled: module.id !== "notify",
        })),
      };
    if (command === "app_setting_list") {
      const { input } = payload as { input: { includeDisabled: boolean } };
      return input.includeDisabled ? entries : [base];
    }
  });
}

test("设置检查保留短文本列宽与横向滚动", async () => {
  setup();
  renderDevtoolsPage("/devtools/settings");
  const table = within(
    await screen.findByRole("table", { name: "设置项检查" }),
  );
  expect(screen.getByRole("region", { name: "设置项检查" }).dataset.axis).toBe(
    "x",
  );
  const row = await table.findByRole("row", {
    name: /^account\.idle_lock_minutes\s/,
  });
  const headers = table.getAllByRole("columnheader");
  for (const label of ["默认值", "来源", "行版本", "生效时机"]) {
    const header = table.getByRole("columnheader", { name: label });
    const cell = row.children[headers.indexOf(header)];
    expect(header.classList.contains("whitespace-nowrap")).toBe(true);
    expect(cell.classList.contains("whitespace-nowrap")).toBe(true);
    expect([...cell.classList].some((name) => name.startsWith("min-w-"))).toBe(
      true,
    );
  }
});

test("列出停用模块可读项，秘密仅显示设置状态，权限收回立即移除受限项", async () => {
  const calls = setup();
  const { client } = renderDevtoolsPage("/devtools/settings");
  const table = within(
    await screen.findByRole("table", { name: "设置项检查" }),
  );
  await table.findByRole("rowheader", { name: "notify.test_disabled" });
  expect(calls).toHaveBeenCalledWith("app_setting_list", {
    input: { includeDisabled: true },
  });
  for (const entry of entries)
    expect(table.getByRole("rowheader", { name: entry.key })).toBeTruthy();
  expect(table.getAllByText("所属模块已停用，此设置只读。")).toHaveLength(1);
  const secretSet = within(
    table.getByRole("row", { name: /^account\.secret_set\s/ }),
  );
  const secretUnset = within(
    table.getByRole("row", { name: /^account\.secret_unset\s/ }),
  );
  expect(secretSet.getByText("已设置")).toBeTruthy();
  expect(secretUnset.getByText("未设置")).toBeTruthy();
  expect(table.queryByText(/MUST_NOT_RENDER/)).toBeNull();
  for (const role of ["button", "switch", "textbox", "combobox", "checkbox"])
    expect(table.queryByRole(role)).toBeNull();
  expect(
    calls.mock.calls.some(([name]) => /app_setting_(set|reset)/.test(name)),
  ).toBe(false);
  await act(async () => {
    client.setQueryData(authKey, { ...activeAuth, permissions: [] });
  });
  await waitFor(() =>
    expect(table.queryByText("notify.test_disabled")).toBeNull(),
  );
  expect(table.getByText("account.idle_lock_minutes")).toBeTruthy();
});

test("设置检查显示后端错误且没有写控件", async () => {
  mockDeveloperIpc((command) => {
    if (command === "app_setting_list")
      throw {
        code: "app.data.not_found",
        params: {},
        traceId: "inspection-query",
      };
  });
  renderDevtoolsPage("/devtools/settings");
  expect((await screen.findByRole("alert")).textContent).toContain(
    "inspection-query",
  );
  expect(
    within(screen.getByRole("table", { name: "设置项检查" })).queryByRole(
      "button",
    ),
  ).toBeNull();
});
