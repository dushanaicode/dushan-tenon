import { readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { i18n } from "@/core/i18n";
import { moduleRoutes } from "@/core/module-directory";
import { MODULE_CATALOG } from "@/lib/generated/assembly";
import { MODULE_IDS, PERMISSION_KEYS } from "@/lib/generated/permissions";
import { manifests } from "./module-registry";

test("真实五模块目录、生成合同与唯一登记顺序一致", () => {
  const ids = ["account", "notify", "files", "devtools", "demo"];
  expect(manifests.map(({ id }) => id)).toEqual(ids);
  expect(MODULE_IDS).toEqual(ids);
  expect(MODULE_CATALOG.map(({ id }) => id)).toEqual(ids);
  expect(
    readdirSync("src/modules", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
  ).toEqual([...ids].sort());
});

test("真实路由和贡献唯一，权限与可见文字来自现行合同", () => {
  const paths = manifests.flatMap((manifest) =>
    moduleRoutes(manifest).map((route) => route.path),
  );
  expect(new Set(paths).size).toBe(paths.length);
  const contributions = manifests.flatMap((manifest) => [
    ...manifest.settings,
    ...manifest.headerWidgets,
    ...manifest.fileTargets,
    ...manifest.workbenchPanels,
  ]);
  expect(new Set(contributions.map(({ id }) => id)).size).toBe(
    contributions.length,
  );
  for (const manifest of manifests) {
    for (const route of moduleRoutes(manifest)) {
      expect(
        route.path === manifest.basePath ||
          route.path.startsWith(`${manifest.basePath}/`),
      ).toBe(true);
      if (route.permission) expect(PERMISSION_KEYS).toContain(route.permission);
    }
    for (const section of manifest.settings) {
      expect(i18n.exists(section.labelKey, { lng: "zh-CN" })).toBe(true);
      expect(i18n.exists(section.labelKey, { lng: "en-US" })).toBe(true);
    }
  }
});
