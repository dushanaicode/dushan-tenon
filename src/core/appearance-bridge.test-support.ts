import type { Appearance, AppearanceSnapshot } from "./appearance-bridge";

const standard: Appearance = {
  mode: "system",
  style: "standard",
  accent: "neutral",
  density: "comfortable",
  motion: "system",
};

/** Ordinary core tests do not load the first-paint script or a whole application. */
export function installAppearanceStub(initial: Partial<Appearance> = {}) {
  const freeze = (value: Appearance): AppearanceSnapshot =>
    Object.freeze({ ...value, dark: value.mode === "dark" });
  let snapshot = freeze({ ...standard, ...initial });
  const listeners = new Set<() => void>();
  window.__TENON_APPEARANCE__ = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply(next) {
      const value = freeze(next);
      if (
        (Object.keys(value) as (keyof AppearanceSnapshot)[]).every(
          (key) => value[key] === snapshot[key],
        )
      )
        return;
      snapshot = value;
      for (const listener of listeners) listener();
    },
  };
}
