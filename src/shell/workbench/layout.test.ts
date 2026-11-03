import { expect, it } from "vitest";
import { WORKBENCH_DEFAULTS } from "@/lib/generated/workbench";
import {
  auxiliaryLayout,
  consoleLayout,
  panelSizes,
  requestedAuxiliaryLayout,
  requestedConsoleLayout,
} from "./layout";

it("Console 夹紧显示宽度并保持请求值，折叠使用 64px", () => {
  const saved = { primaryWidth: 360, primaryCollapsed: false };
  expect(consoleLayout(saved, 650).primaryWidth).toBe(249);
  expect(saved.primaryWidth).toBe(360);
  expect(
    consoleLayout({ ...saved, primaryCollapsed: true }, 650).primaryWidth,
  ).toBe(64);
  expect(requestedConsoleLayout(64, saved)).toEqual({
    ...saved,
    primaryCollapsed: true,
  });
  expect(requestedConsoleLayout(1000, saved).primaryWidth).toBe(360);
});
it.each([600, 900, 1099])("%s 容器使用辅助 sheet，不写请求几何", (width) => {
  const saved = { width: 480, visible: true, panel: "inspector" };
  expect(auxiliaryLayout(saved, width, true, false)).toMatchObject({
    asSheet: true,
    docked: false,
  });
  expect(saved.visible).toBe(true);
});
it("宽档停靠辅助面板，Zen 和权限收回隐藏；折叠保留宽度", () => {
  const saved = { width: 400, visible: true, panel: "inspector" };
  expect(auxiliaryLayout(saved, 1200, true, false).docked).toBe(true);
  expect(auxiliaryLayout(saved, 1200, false, false).docked).toBe(false);
  expect(auxiliaryLayout(saved, 1200, true, true).docked).toBe(false);
  expect(requestedAuxiliaryLayout(0, saved)).toEqual({
    width: 400,
    visible: false,
  });
});
it("尺寸比例扣除分隔条；无边栏时为单一正文", () => {
  expect(panelSizes(1200, null, null)).toEqual({ content: 100 });
  const sizes = panelSizes(
    1200,
    WORKBENCH_DEFAULTS.layouts.console.primaryWidth,
    320,
  );
  expect(Object.values(sizes).reduce((sum, size) => sum + size, 0)).toBeCloseTo(
    100,
  );
});
