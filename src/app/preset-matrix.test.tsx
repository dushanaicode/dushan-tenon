import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import {
  activeAuth,
  appModules,
  currentUser,
  paramEntries,
} from "@/core/core.test-support";
import { canOpenPath } from "@/core/enabled-modules";
import { i18n } from "@/core/i18n";
import { moduleRoutes } from "@/core/module-directory";
import { MODULE_CATALOG, PRESET_CATALOG } from "@/lib/generated/assembly";
import { notifyParams } from "@/modules/notify/notify.test-support";
import { buildNavTree, navLeaves } from "@/shell";
import { mockAppIpc, renderApp } from "./app.test-support";
import { manifests } from "./module-registry";
import { buildSections } from "./settings/sections";

const selected = process.env.TENON_TEST_PRESET;
const presets = PRESET_CATALOG.filter(
  (preset) => selected === undefined || preset.name === selected,
);
if (presets.length === 0)
  throw new Error(`Unknown TENON_TEST_PRESET: ${selected}`);
const cases = presets.flatMap((preset) =>
  (["none", "login"] as const).flatMap((mode) =>
    [false, true].map((developerMode) => ({ preset, mode, developerMode })),
  ),
);

test.each(cases)(
  "真实预设 $preset.name / $mode / developer=$developerMode 的导航、设置和路由一致",
  async ({ preset, mode, developerMode }) => {
    const enabled = new Set<string>(preset.enabledModules);
    const modules = appModules.modules.map((module) => ({
      ...module,
      enabled: enabled.has(module.id),
    }));
    const auth = { ...activeAuth, mode, user: { ...currentUser, mode } };
    const params = [
      ...paramEntries.filter((entry) => entry.moduleId !== "notify"),
      ...notifyParams,
    ].filter((entry) => enabled.has(entry.moduleId));
    mockAppIpc((command) => {
      if (command === "app_modules_list") return { modules };
      if (command === "account_auth_status") return auth;
      if (command === "app_setting_list") return params;
    });
    renderApp("/settings/general", {
      developerMode: { value: developerMode, source: "file" },
    });
    await screen.findByRole("heading", { name: "通用" });
    const visibility = {
      authenticated: true,
      mode,
      developerMode,
      permissions: auth.permissions,
    };
    const table = buildSections({
      manifests,
      enabled,
      auth: visibility,
      params,
    });
    const settings = screen.getByRole("navigation", { name: "设置" });
    expect(
      within(settings)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(table.visible.map((section) => section.path));
    for (const section of table.visible)
      if (section.moduleId !== null)
        expect(enabled.has(section.moduleId)).toBe(true);
    const tree = buildNavTree(manifests, enabled, visibility);
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    for (const button of navigation.querySelectorAll<HTMLButtonElement>(
      '[data-nav-kind="parent"][aria-expanded="false"]',
    ))
      fireEvent.click(button);
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(navLeaves(tree).map(({ item }) => item.path));
    expect(tree.groups.some((group) => group.id === "developer")).toBe(
      developerMode &&
        (enabled.has("files") ||
          enabled.has("devtools") ||
          enabled.has("demo")),
    );
    for (const manifest of manifests) {
      for (const route of moduleRoutes(manifest)) {
        const path = route.path.replace(/:[^/]+/g, "matrix-test");
        expect(canOpenPath(manifests, enabled, visibility, path)).toBe(
          enabled.has(manifest.id) && (!route.developerOnly || developerMode),
        );
      }
    }
  },
);

test.each(presets)(
  "预设 $name 关闭的模块直达为 404，不发业务请求",
  async (preset) => {
    const enabled = new Set<string>(preset.enabledModules);
    const calls = mockAppIpc((command) =>
      command === "app_modules_list"
        ? {
            modules: appModules.modules.map((module) => ({
              ...module,
              enabled: enabled.has(module.id),
            })),
          }
        : undefined,
    );
    const { router } = renderApp("/", {
      developerMode: { value: true, source: "file" },
    });
    await screen.findByRole("heading", { name: i18n.t("app.name") });
    for (const manifest of manifests.filter(
      (module) => !enabled.has(module.id),
    )) {
      const route = moduleRoutes(manifest)[0];
      if (route) {
        await act(async () => {
          await router.navigate(route.path.replace(/:[^/]+/g, "matrix-test"));
        });
        await screen.findByRole("heading", { name: i18n.t("notFound.title") });
        expect(screen.getByText("404")).toBeTruthy();
      }
      expect(
        calls.mock.calls.some(([command]) =>
          command.startsWith(`${manifest.id}_`),
        ),
      ).toBe(false);
    }
  },
);

test("minimal 仅包含核心模块，full 仍需显式开启开发者模式", async () => {
  expect(
    PRESET_CATALOG.find(({ name }) => name === "minimal")?.enabledModules,
  ).toEqual(MODULE_CATALOG.filter(({ core }) => core).map(({ id }) => id));
  mockAppIpc();
  const { client } = renderApp("/settings/advanced");
  const control = await screen.findByRole("switch", { name: "开发者模式" });
  expect(control.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(control);
  await waitFor(() =>
    expect(control.getAttribute("aria-checked")).toBe("true"),
  );
  expect(screen.getByText(i18n.t("nav.developer"))).toBeTruthy();
  expect(
    client.getQueryData<{ developerMode: { value: boolean } }>([
      "app",
      "settings",
    ])?.developerMode.value,
  ).toBe(true);
});
