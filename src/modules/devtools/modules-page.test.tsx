import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { appModules, mockDeveloperIpc } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import { renderDevtoolsPage } from "./devtools.test-support";

test.each([
  ["zh-CN", "模块列表", "已启用", "核心", "已禁用", "可选"],
  ["en-US", "Module registry", "Enabled", "Core", "Disabled", "Optional"],
] as const)(
  "完整只读模块表：%s",
  async (language, title, enabled, core, disabled, optional) => {
    await i18n.changeLanguage(language);
    const calls = mockDeveloperIpc(
      (command) =>
        command === "app_modules_list"
          ? {
              modules: appModules.modules.map((module) =>
                module.id === "notify"
                  ? {
                      ...module,
                      version: "2.0.0",
                      enabled: false,
                      appliedMigrations: 4,
                    }
                  : module,
              ),
            }
          : undefined,
      { language: { value: language, source: "file" } },
    );
    renderDevtoolsPage("/devtools/modules");
    const table = within(await screen.findByRole("table", { name: title }));
    const account = within(
      await table.findByRole("row", { name: /^account\s/ }),
    );
    for (const value of ["0.1.0-alpha.1", enabled, core, "0"])
      expect(account.getByText(value)).toBeTruthy();
    const notify = within(table.getByRole("row", { name: /^notify\s/ }));
    for (const value of ["2.0.0", disabled, optional, "4"])
      expect(notify.getByText(value)).toBeTruthy();
    for (const { id } of appModules.modules)
      expect(table.getByRole("rowheader", { name: id })).toBeTruthy();
    expect(table.queryByRole("switch")).toBeNull();
    expect(table.queryByRole("button")).toBeNull();
    expect(
      calls.mock.calls.some(([name]) => name === "app_modules_update"),
    ).toBe(false);
  },
);

test("模块查询错误保留追踪信息", async () => {
  mockDeveloperIpc((command) => {
    if (command === "app_modules_list")
      throw {
        code: "app.internal.unexpected",
        params: {},
        traceId: "module-registry-error",
      };
  });
  const { ModulesPage } = await import("./modules-page");
  const { renderDevtools } = await import("./devtools.test-support");
  renderDevtools(<ModulesPage />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "module-registry-error",
  );
});
