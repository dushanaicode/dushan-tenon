import { useSyncExternalStore } from "react";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { Theme } from "@/lib/generated/Theme";

type AppearanceSnapshot = Readonly<{ mode: Theme; dark: boolean }>;
type AppearanceBridge = {
  getSnapshot: () => AppearanceSnapshot;
  subscribe: (listener: () => void) => () => void;
  applyMode: (mode: Theme) => void;
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

export function applyMode(mode: Theme) {
  bridge().applyMode(mode);
}

export function useAppearanceSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
