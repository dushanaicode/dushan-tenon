import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  declarations,
  findRule,
  resolveToken,
  tokensFor,
} from "@/kit/styles/styles.test-support";
import type { ThemeStyle } from "@/lib/generated/ThemeStyle";

type Sheet = Parameters<typeof findRule>[0];
const require = createRequire(import.meta.resolve("vite/package.json"));
const { parse }: { parse: (source: string) => Sheet } = require("postcss");

export function themeCss(id: ThemeStyle) {
  return parse(readFileSync(`src/visual/themes/${id}/theme.css`, "utf8"));
}

export const lightSelector = (id: ThemeStyle) =>
  `:root[data-theme-style="${id}"]`;
export const darkSelector = (id: ThemeStyle) =>
  `:root.dark[data-theme-style="${id}"]`;

/** 按浏览器级联合并：套件默认 →（深色）主题浅色块 →（深色）主题深色块。 */
export function themeTokens(id: ThemeStyle, mode: "light" | "dark") {
  const sheet = themeCss(id);
  return {
    ...tokensFor(mode),
    ...declarations(findRule(sheet, lightSelector(id))),
    ...(mode === "dark" ? declarations(findRule(sheet, darkSelector(id))) : {}),
  };
}

/** 把令牌解析成不透明 sRGB；半透明颜色按主题底色合成。 */
export function opaque(
  tokens: Record<string, string>,
  name: string,
): `#${string}` {
  const value = resolveToken(tokens, name);
  if (/^#[\da-f]{6}$/i.test(value)) return value as `#${string}`;
  const match = value.match(/^rgb\((\d+) (\d+) (\d+) \/ (\d+(?:\.\d+)?)%\)$/);
  if (!match) throw new Error(`${name}: unsupported color ${value}`);
  const base = resolveToken(tokens, "--background");
  const alpha = Number(match[4]) / 100;
  const channel = (index: number) => {
    const under = Number.parseInt(base.slice(1 + index * 2, 3 + index * 2), 16);
    const over = Number(match[index + 1]);
    return Math.round(over * alpha + under * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
