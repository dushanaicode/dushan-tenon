import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppSettings } from "@/lib/generated/AppSettings";
import {
  ACCENTS,
  DENSITIES,
  THEME_STYLES,
  THEMES,
} from "@/lib/generated/appearance";
import type { Theme } from "@/lib/generated/Theme";
import {
  type Appearance,
  appearanceOf,
  applyAppearance,
  getInitialSettings,
  getSnapshot,
  subscribe,
  useAppearanceSnapshot,
} from "./appearance-bridge";
import { defaultSettings } from "./core.test-support";

const script = readFileSync(resolve("public/appearance.js"), "utf8");
const root = document.documentElement;

it("returns the host settings without copying or changing them", () => {
  window.__TENON_INITIAL_SETTINGS__ = { settings: defaultSettings };
  expect(getInitialSettings()).toBe(defaultSettings);
});

it("reports missing host settings explicitly", () => {
  delete window.__TENON_INITIAL_SETTINGS__;
  expect(getInitialSettings).toThrow("Host initial settings are required");
});

function settingsWith(patch: Partial<Appearance>): AppSettings {
  const value = { ...appearanceOf(defaultSettings), ...patch };
  return {
    ...defaultSettings,
    theme: { value: value.mode, source: "file" },
    themeStyle: { value: value.style, source: "file" },
    accent: { value: value.accent, source: "file" },
    density: { value: value.density, source: "file" },
    motion: { value: value.motion, source: "file" },
  };
}

function boot(patch: Partial<Appearance> = {}, dark = false) {
  const media = new EventTarget();
  let matches = dark;
  Object.defineProperty(media, "matches", { get: () => matches });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  window.__TENON_INITIAL_SETTINGS__ = { settings: settingsWith(patch) };
  delete window.__TENON_APPEARANCE__;
  new Function(script)();
  return (next: boolean) => {
    matches = next;
    media.dispatchEvent(new Event("change"));
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__TENON_INITIAL_SETTINGS__;
  delete window.__TENON_APPEARANCE__;
  root.classList.remove("dark");
  root.style.removeProperty("color-scheme");
  for (const key of ["themeStyle", "accent", "density", "motion"])
    delete root.dataset[key];
});

it.each<[Theme, boolean, boolean]>([
  ["light", true, false],
  ["dark", false, true],
  ["system", false, false],
  ["system", true, true],
])(
  "synchronously paints %s with system dark=%s before React mounts",
  (mode, systemDark, dark) => {
    boot({ mode }, systemDark);
    expect(root.classList.contains("dark")).toBe(dark);
    expect(root.style.colorScheme).toBe(dark ? "dark" : "light");
    expect(getSnapshot()).toEqual({
      mode,
      dark,
      style: "standard",
      accent: "neutral",
      density: "comfortable",
      motion: true,
    });
    expect(getSnapshot()).toBe(getSnapshot());
    const { result } = renderHook(useAppearanceSnapshot);
    expect(result.current).toBe(getSnapshot());
  },
);

it("paints style, accent, density and motion as root attributes", () => {
  boot({ style: "ink", accent: "rose", density: "compact", motion: false });
  expect({ ...root.dataset }).toEqual({
    themeStyle: "ink",
    accent: "rose",
    density: "compact",
    motion: "off",
  });
  const listener = vi.fn();
  subscribe(listener);
  act(() =>
    applyAppearance({ ...appearanceOf(settingsWith({})), style: "cyber" }),
  );
  expect({ ...root.dataset }).toEqual({
    themeStyle: "cyber",
    accent: "neutral",
    density: "comfortable",
    motion: "on",
  });
  expect(getSnapshot().style).toBe("cyber");
  expect(listener).toHaveBeenCalledTimes(1);
  const current = getSnapshot();
  applyAppearance({ ...appearanceOf(settingsWith({})), style: "cyber" });
  expect(getSnapshot()).toBe(current);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("accepts every generated value", () => {
  for (const mode of THEMES) boot({ mode });
  for (const style of THEME_STYLES) boot({ style });
  for (const accent of ACCENTS) boot({ accent });
  for (const density of DENSITIES) boot({ density });
  for (const motion of [true, false]) boot({ motion });
  expect(getSnapshot().motion).toBe(false);
});

it("follows system changes, preserves snapshot identity for no-ops, and unsubscribes", () => {
  const change = boot({ mode: "system" });
  const original = getSnapshot();
  const listener = vi.fn();
  const stop = subscribe(listener);
  const { result, unmount } = renderHook(useAppearanceSnapshot);
  act(() => change(false));
  expect(getSnapshot()).toBe(original);
  expect(listener).not.toHaveBeenCalled();
  act(() => change(true));
  expect(result.current).toEqual({ ...original, dark: true });
  expect(result.current).toBe(getSnapshot());
  expect(listener).toHaveBeenCalledTimes(1);
  act(() => applyAppearance(appearanceOf(settingsWith({ mode: "system" }))));
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  unmount();
  change(false);
  expect(listener).toHaveBeenCalledTimes(1);
});

it.each(["light", "dark"] as const)(
  "explicit %s ignores system changes and can rejoin System",
  (mode) => {
    const change = boot({ mode });
    const original = getSnapshot();
    change(true);
    change(false);
    expect(getSnapshot()).toBe(original);
    applyAppearance(appearanceOf(settingsWith({ mode: "system" })));
    change(true);
    expect(getSnapshot()).toMatchObject({ mode: "system", dark: true });
  },
);

it("fails explicitly without host input, without reading local storage or guessing DOM state", () => {
  delete window.__TENON_INITIAL_SETTINGS__;
  delete window.__TENON_APPEARANCE__;
  const read = vi.spyOn(Storage.prototype, "getItem");
  expect(() => new Function(script)()).toThrow("host appearance mode");
  expect(() => getSnapshot()).toThrow("Host appearance bootstrap is required");
  expect(read).not.toHaveBeenCalled();
});

it.each<[keyof Appearance, unknown]>([
  ["mode", "invalid"],
  ["style", "glass"],
  ["accent", "teal"],
  ["density", "cozy"],
  ["motion", "on"],
])(
  "rejects an invalid %s at boot and at runtime without changing the snapshot",
  (key, value) => {
    boot({ mode: "light" });
    const previous = getSnapshot();
    const runtime = window.__TENON_APPEARANCE__;
    const invalid = { ...appearanceOf(settingsWith({})), [key]: value };
    expect(() => Reflect.apply(applyAppearance, null, [invalid])).toThrow(
      `host appearance ${key}`,
    );
    expect(getSnapshot()).toBe(previous);
    window.__TENON_INITIAL_SETTINGS__ = {
      settings: settingsWith(invalid as Appearance),
    };
    expect(() => new Function(script)()).toThrow(`host appearance ${key}`);
    expect(window.__TENON_APPEARANCE__).toBe(runtime);
  },
);
