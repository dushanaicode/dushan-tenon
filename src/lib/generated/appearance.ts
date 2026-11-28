// 自动生成，勿手改。运行 pnpm generate 更新。
export const THEMES = ["light", "dark", "system"] as const;
export const THEME_STYLES = ["standard", "ink", "cyber"] as const;
export const ACCENTS = [
  "neutral",
  "azure",
  "violet",
  "emerald",
  "amber",
  "rose",
] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const MOTIONS = ["system", "on", "off"] as const;
export const NATIVE_BACKGROUNDS = {
  cyber: { dark: [5, 7, 15, 255], light: [244, 248, 255, 255] },
  ink: { dark: [20, 23, 26, 255], light: [244, 239, 228, 255] },
  standard: { dark: [15, 16, 18, 255], light: [246, 246, 247, 255] },
} as const;
export const APPEARANCE_DEFAULTS = {
  accent: "neutral",
  density: "comfortable",
  motion: "system",
  theme: "system",
  themeStyle: "standard",
} as const;
