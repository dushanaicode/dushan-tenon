import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import type { ModuleRoute } from "@/core/contracts/module";
import {
  activeAuth,
  appModules,
  defaultSettings,
  mockAppIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import { ModuleGate } from "./module-gate";

function mount(route: Partial<ModuleRoute> = {}, moduleId = "files") {
  const factory = vi.fn(async () => ({ default: () => <h1>授权页面</h1> }));
  const { client } = queryWrapper();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ModuleGate
          moduleId={moduleId}
          route={{ path: "/files", Component: factory, ...route }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, factory };
}

test.each([
  "disabled",
  "developer",
  "permission",
  "authMode",
  "anonymous",
] as const)("%s 门控阻止调用懒工厂", async (kind) => {
  mockAppIpc((command) => {
    if (command === "app_modules_list" && kind === "disabled")
      return {
        modules: appModules.modules.map((module) => ({
          ...module,
          enabled: false,
        })),
      };
    if (command === "account_auth_status")
      return {
        ...activeAuth,
        state: kind === "anonymous" ? "anonymous" : "active",
        permissions: [],
      };
  });
  const { factory } = mount({
    ...(kind === "developer" ? { developerOnly: true } : {}),
    ...(kind === "permission" ? { permission: "files.file.read" } : {}),
    ...(kind === "authMode" ? { authMode: "login" } : {}),
  });
  expect(
    await screen.findByText(
      kind === "disabled" || kind === "developer" ? "404" : "403",
    ),
  ).toBeTruthy();
  expect(factory).not.toHaveBeenCalled();
});

test.each(["app_modules_list", "account_auth_status", "app_settings_get"])(
  "%s 未就绪及失败不调用懒工厂",
  async (command) => {
    let reject!: (error: unknown) => void;
    const pending = new Promise<never>((_, fail) => {
      reject = fail;
    });
    mockAppIpc((name) => (name === command ? pending : undefined));
    const { factory } = mount({ developerOnly: true });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(factory).not.toHaveBeenCalled();
    await act(async () =>
      reject({
        code: "app.cache.unavailable",
        params: {},
        traceId: "gate-error",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "gate-error",
    );
    expect(factory).not.toHaveBeenCalled();
  },
);

test("可见后才加载，权限收回立即卸载内容", async () => {
  mockAppIpc(undefined, { developerMode: { value: true, source: "file" } });
  const { client, factory } = mount({
    developerOnly: true,
    permission: "files.file.read",
  });
  await screen.findByRole("heading", { name: "授权页面" });
  expect(factory).toHaveBeenCalledTimes(1);
  act(() =>
    client.setQueryData(["account", "auth"], {
      ...activeAuth,
      permissions: [],
    }),
  );
  await screen.findByRole("heading", { name: i18n.t("forbidden.title") });
  expect(screen.queryByText("授权页面")).toBeNull();
  act(() => client.setQueryData(["app", "settings"], defaultSettings));
  expect(await screen.findByText("404")).toBeTruthy();
});
