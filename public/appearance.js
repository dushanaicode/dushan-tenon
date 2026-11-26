(() => {
  // 取值与 src/lib/generated/appearance.ts 一致，由外观桥测试核对。
  const OPTIONS = {
    mode: ["light", "dark", "system"],
    style: ["standard", "ink", "cyber"],
    accent: ["neutral", "azure", "violet", "emerald", "amber", "rose"],
    density: ["comfortable", "compact"],
  };
  function validate(value) {
    for (const [key, options] of Object.entries(OPTIONS)) {
      if (!options.includes(value?.[key])) {
        throw new Error(`A valid host appearance ${key} is required`);
      }
    }
    if (typeof value.motion !== "boolean") {
      throw new Error("A valid host appearance motion is required");
    }
  }
  const settings = window.__TENON_INITIAL_SETTINGS__?.settings;
  const initial = {
    mode: settings?.theme?.value,
    style: settings?.themeStyle?.value,
    accent: settings?.accent?.value,
    density: settings?.density?.value,
    motion: settings?.motion?.value,
  };
  validate(initial);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set();
  const isDark = (mode) =>
    mode === "dark" || (mode === "system" && media.matches);
  const freeze = (value) =>
    Object.freeze({
      mode: value.mode,
      dark: isDark(value.mode),
      style: value.style,
      accent: value.accent,
      density: value.density,
      motion: value.motion,
    });
  let snapshot = freeze(initial);
  const paint = () => {
    const root = document.documentElement;
    root.classList.toggle("dark", snapshot.dark);
    root.style.colorScheme = snapshot.dark ? "dark" : "light";
    root.dataset.themeStyle = snapshot.style;
    root.dataset.accent = snapshot.accent;
    root.dataset.density = snapshot.density;
    root.dataset.motion = snapshot.motion ? "on" : "off";
  };
  const apply = (value) => {
    validate(value);
    const next = freeze(value);
    if (Object.keys(next).every((key) => next[key] === snapshot[key])) return;
    snapshot = next;
    paint();
    for (const listener of listeners) listener();
  };
  paint();
  media.addEventListener("change", () => {
    if (snapshot.mode === "system") apply(snapshot);
  });
  window.__TENON_APPEARANCE__ = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply,
  };
})();
