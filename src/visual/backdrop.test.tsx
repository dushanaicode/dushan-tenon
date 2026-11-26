import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type Appearance,
  appearanceOf,
  applyAppearance,
} from "@/core/appearance-bridge";
import { installAppearanceStub } from "@/core/appearance-bridge.test-support";
import { defaultSettings } from "@/core/core.test-support";
import { Backdrop } from "./backdrop";

let reduced = false;
const media = new EventTarget();

beforeEach(() => {
  reduced = false;
  Object.defineProperty(media, "matches", {
    configurable: true,
    get: () => reduced,
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function show(appearance: Partial<Appearance>) {
  installAppearanceStub(appearance);
  return render(<Backdrop />);
}

const layer = (container: HTMLElement) =>
  container.querySelector('[data-visual="backdrop"]');

it("标准主题没有背景层", () => {
  const { container } = show({ style: "standard" });
  expect(layer(container)).toBeNull();
});

it.each([
  ["ink", "light", "/themes/ink/light.webp"],
  ["ink", "dark", "/themes/ink/dark.webp"],
  ["cyber", "light", "/themes/cyber/light.webp"],
  ["cyber", "dark", "/themes/cyber/dark.webp"],
] as const)(
  "%s %s 显示对应背景图和场景画布，对读屏隐藏",
  (style, mode, src) => {
    const { container } = show({ style, mode });
    const backdrop = layer(container);
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.querySelector("img")?.getAttribute("src")).toBe(src);
    expect(backdrop?.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(backdrop?.querySelector("canvas")).not.toBeNull();
  },
);

it("关闭动效或系统减少动态效果时不运行场景，只留背景图", () => {
  const { container } = show({ style: "ink", motion: false });
  expect(layer(container)?.querySelector("img")).not.toBeNull();
  expect(layer(container)?.querySelector("canvas")).toBeNull();
  act(() =>
    applyAppearance({
      ...appearanceOf(defaultSettings),
      style: "ink",
      motion: true,
    }),
  );
  expect(layer(container)?.querySelector("canvas")).not.toBeNull();
  act(() => {
    reduced = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(layer(container)?.querySelector("canvas")).toBeNull();
});

it("切换主题与明暗时跟随外观桥", () => {
  const { container } = show({ style: "ink", mode: "light" });
  act(() =>
    applyAppearance({
      ...appearanceOf(defaultSettings),
      style: "cyber",
      mode: "dark",
    }),
  );
  expect(layer(container)?.querySelector("img")?.getAttribute("src")).toBe(
    "/themes/cyber/dark.webp",
  );
  act(() =>
    applyAppearance({ ...appearanceOf(defaultSettings), style: "standard" }),
  );
  expect(layer(container)).toBeNull();
});
