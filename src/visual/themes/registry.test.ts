import { existsSync, statSync } from "node:fs";
import { expect, it } from "vitest";
import en from "@/core/i18n/en-US.json";
import zh from "@/core/i18n/zh-CN.json";
import {
  ancestors,
  contrast,
  declarations,
  findRule,
  rules,
  textPairs,
  tokensFor,
} from "@/kit/styles/styles.test-support";
import {
  ACCENTS,
  NATIVE_BACKGROUNDS,
  THEME_STYLES,
} from "@/lib/generated/appearance";
import {
  darkSelector,
  lightSelector,
  opaque,
  themeCss,
  themeTokens,
} from "../visual.test-support";
import { VISUAL_THEMES } from "./registry";

const hex = (rgba: readonly number[]) =>
  `#${rgba
    .slice(0, 3)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;

it("注册表与生成的主题列表一一对应，名称与说明有两种语言", () => {
  expect(Object.keys(VISUAL_THEMES).sort()).toEqual([...THEME_STYLES].sort());
  for (const id of THEME_STYLES) {
    expect(VISUAL_THEMES[id].id).toBe(id);
    for (const key of [`visual.theme.${id}`, `visual.theme.${id}.description`])
      for (const resource of [zh, en])
        expect(Object.hasOwn(resource, key), key).toBe(true);
  }
});

it("背景主题的图片都在 public/ 下，原图不超过 450 KB、缩略图不超过 40 KB", () => {
  for (const id of THEME_STYLES) {
    const art = VISUAL_THEMES[id].art;
    if (!art) continue;
    for (const [url, limit] of [
      [art.image.light, 450_000],
      [art.image.dark, 450_000],
      [art.thumb.light, 40_000],
      [art.thumb.dark, 40_000],
    ] as const) {
      const file = `public${url}`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThanOrEqual(limit);
    }
  }
});

it.each(THEME_STYLES.filter((id) => id !== "standard"))(
  "%s 的底色与原生窗口底色一致，深色块覆盖浅色块的每个颜色",
  (id) => {
    const sheet = themeCss(id);
    const light = declarations(findRule(sheet, lightSelector(id)));
    const dark = declarations(findRule(sheet, darkSelector(id)));
    for (const rule of [
      findRule(sheet, lightSelector(id)),
      findRule(sheet, darkSelector(id)),
    ])
      expect(ancestors(rule)).toContainEqual(
        expect.objectContaining({ name: "layer", params: "appearance-themes" }),
      );
    expect(light["--background"]).toBe(hex(NATIVE_BACKGROUNDS[id].light));
    expect(dark["--background"]).toBe(hex(NATIVE_BACKGROUNDS[id].dark));
    const shared = /^--(?:r-|ink-heading$|cyber-mono$)/;
    for (const [name, value] of Object.entries(light)) {
      if (shared.test(name) || value.startsWith("var(")) continue;
      expect(Object.hasOwn(dark, name), `${id} dark ${name}`).toBe(true);
    }
    expect(light["--visual-veil"]).toBeTruthy();
  },
);

it("标准主题沿用套件底色", () => {
  for (const mode of ["light", "dark"] as const)
    expect(tokensFor(mode)["--background"]).toBe(
      hex(NATIVE_BACKGROUNDS.standard[mode]),
    );
});

it.each(
  THEME_STYLES.filter((id) => id !== "standard").flatMap((id) =>
    (["light", "dark"] as const).map((mode) => [id, mode] as const),
  ),
)("%s %s 主要文字组合均达到 WCAG AA 4.5:1", (id, mode) => {
  const tokens = themeTokens(id, mode);
  for (const [foreground, background] of textPairs) {
    const ratio = contrast(
      opaque(tokens, `--${foreground}`),
      opaque(tokens, `--${background}`),
    );
    expect(
      ratio,
      `${id} ${mode}: ${foreground}/${background} = ${ratio.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

it("标准主题每个强调色在两种明暗下都有主色系，主色文字达到 4.5:1", () => {
  const sheet = themeCss("standard");
  const selectors = rules(sheet).map((rule) => rule.selector);
  for (const accent of ACCENTS.filter((value) => value !== "neutral"))
    for (const dark of [false, true]) {
      const selector = `:root${dark ? ".dark" : ""}[data-theme-style="standard"][data-accent="${accent}"]`;
      expect(selectors).toContain(selector);
      const tokens = declarations(findRule(sheet, selector));
      expect(Object.keys(tokens).sort()).toEqual([
        "--primary",
        "--primary-active",
        "--primary-foreground",
        "--primary-hover",
      ]);
      for (const background of [
        "--primary",
        "--primary-hover",
        "--primary-active",
      ])
        expect(
          contrast(tokens["--primary-foreground"], tokens[background]),
          `${selector} ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
    }
  expect(selectors.some((selector) => selector.includes("neutral"))).toBe(
    false,
  );
});
