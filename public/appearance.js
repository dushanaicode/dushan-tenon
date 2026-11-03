(() => {
  const initial = window.__TENON_INITIAL_SETTINGS__;
  const mode = initial?.settings?.theme?.value;
  function validate(value) {
    if (value !== "light" && value !== "dark" && value !== "system") {
      throw new Error("A valid host appearance mode is required");
    }
  }
  validate(mode);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set();
  const isDark = (value) =>
    value === "dark" || (value === "system" && media.matches);
  let snapshot = Object.freeze({ mode, dark: isDark(mode) });
  const paint = () => {
    document.documentElement.classList.toggle("dark", snapshot.dark);
    document.documentElement.style.colorScheme = snapshot.dark
      ? "dark"
      : "light";
  };
  const applyMode = (nextMode) => {
    validate(nextMode);
    const dark = isDark(nextMode);
    if (snapshot.mode === nextMode && snapshot.dark === dark) return;
    snapshot = Object.freeze({ mode: nextMode, dark });
    paint();
    for (const listener of listeners) listener();
  };
  paint();
  media.addEventListener("change", () => {
    if (snapshot.mode === "system") applyMode("system");
  });
  window.__TENON_APPEARANCE__ = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyMode,
  };
})();
