import { useSyncExternalStore } from "react";
import type { Accent } from "@/lib/generated/Accent";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { Density } from "@/lib/generated/Density";
import type { Theme } from "@/lib/generated/Theme";
import type { ThemeStyle } from "@/lib/generated/ThemeStyle";

export type Appearance = Readonly<{
  mode: Theme;
  style: ThemeStyle;
  accent: Accent;
  density: Density;
  motion: boolean;
}>;
export type AppearanceSnapshot = Readonly<Appearance & { dark: boolean }>;
type AppearanceBridge = {
  getSnapshot: () => AppearanceSnapshot;
  subscribe: (listener: () => void) => () => void;
  apply: (appearance: Appearance) => void;
};

declare global {
  interface Window {
    __TENON_INITIAL_SETTINGS__?: { settings: AppSettings };
    __TENON_APPEARANCE__?: AppearanceBridge;
  }
}

function bridge(): AppearanceBridge {
  const value = window.__TENON_APPEARANCE__;
  if (!value) throw new Error("Host appearance bootstrap is required");
  return value;
}

export function getInitialSettings(): AppSettings {
  const initial = window.__TENON_INITIAL_SETTINGS__;
  if (!initial) throw new Error("Host initial settings are required");
  return initial.settings;
}

export function getSnapshot(): AppearanceSnapshot {
  return bridge().getSnapshot();
}

export function subscribe(listener: () => void) {
  return bridge().subscribe(listener);
}

export function appearanceOf(settings: AppSettings): Appearance {
  return {
    mode: settings.theme.value,
    style: settings.themeStyle.value,
    accent: settings.accent.value,
    density: settings.density.value,
    motion: settings.motion.value,
  };
}

export function applyAppearance(appearance: Appearance) {
  bridge().apply(appearance);
}

export function useAppearanceSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
