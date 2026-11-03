import type { Theme } from "@/lib/generated/Theme";

/** Ordinary core tests do not load the first-paint script or a whole application. */
export function installAppearanceStub(mode: Theme = "system") {
  let snapshot = Object.freeze({ mode, dark: mode === "dark" });
  const listeners = new Set<() => void>();
  window.__TENON_APPEARANCE__ = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyMode(next) {
      if (snapshot.mode === next) return;
      snapshot = Object.freeze({ mode: next, dark: next === "dark" });
      for (const listener of listeners) listener();
    },
  };
}
