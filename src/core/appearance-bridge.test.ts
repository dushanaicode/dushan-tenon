import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Theme } from "@/lib/generated/Theme";
import {
  applyMode,
  getSnapshot,
  subscribe,
  useAppearanceSnapshot,
} from "./appearance-bridge";
import { defaultSettings } from "./core.test-support";

const script = readFileSync(resolve("public/appearance.js"), "utf8");
function boot(mode: Theme, dark = false) {
  const media = new EventTarget();
  let matches = dark;
  Object.defineProperty(media, "matches", { get: () => matches });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  window.__TENON_INITIAL_SETTINGS__ = {
    settings: { ...defaultSettings, theme: { value: mode, source: "file" } },
  };
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
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("color-scheme");
});

it.each<[Theme, boolean, boolean]>([
  ["light", true, false],
  ["dark", false, true],
  ["system", false, false],
  ["system", true, true],
])(
  "synchronously paints %s with system dark=%s before React mounts",
  (mode, systemDark, dark) => {
    boot(mode, systemDark);
    expect(document.documentElement.classList.contains("dark")).toBe(dark);
    expect(document.documentElement.style.colorScheme).toBe(
      dark ? "dark" : "light",
    );
    expect(getSnapshot()).toEqual({ mode, dark });
    expect(getSnapshot()).toBe(getSnapshot());
    const { result } = renderHook(useAppearanceSnapshot);
    expect(result.current).toBe(getSnapshot());
  },
);

it("follows system changes, preserves snapshot identity for no-ops, and unsubscribes", () => {
  const change = boot("system");
  const original = getSnapshot();
  const listener = vi.fn();
  const stop = subscribe(listener);
  const { result, unmount } = renderHook(useAppearanceSnapshot);
  act(() => change(false));
  expect(getSnapshot()).toBe(original);
  expect(listener).not.toHaveBeenCalled();
  act(() => change(true));
  expect(result.current).toEqual({ mode: "system", dark: true });
  expect(result.current).toBe(getSnapshot());
  expect(listener).toHaveBeenCalledTimes(1);
  act(() => applyMode("system"));
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  unmount();
  change(false);
  expect(listener).toHaveBeenCalledTimes(1);
});

it.each(["light", "dark"] as const)(
  "explicit %s ignores system changes and can rejoin System",
  (mode) => {
    const change = boot(mode);
    const original = getSnapshot();
    change(true);
    change(false);
    expect(getSnapshot()).toBe(original);
    applyMode("system");
    change(true);
    expect(getSnapshot()).toEqual({ mode: "system", dark: true });
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

it("rejects invalid initial and runtime modes without changing the saved snapshot", () => {
  boot("light");
  const previous = getSnapshot();
  const runtime = window.__TENON_APPEARANCE__;
  expect(() => Reflect.apply(applyMode, null, ["invalid"])).toThrow(
    "host appearance mode",
  );
  expect(getSnapshot()).toBe(previous);
  window.__TENON_INITIAL_SETTINGS__ = {
    settings: {
      ...defaultSettings,
      theme: { value: "invalid" as Theme, source: "file" },
    },
  };
  expect(() => new Function(script)()).toThrow("host appearance mode");
  expect(window.__TENON_APPEARANCE__).toBe(runtime);
});
