import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

type CssNode = {
  type: string;
  name?: string;
  params?: string;
  parent?: CssNode;
};

type CssDeclaration = {
  type: string;
  prop: string;
  value: string;
  important?: boolean;
};

export type CssRule = CssNode & {
  selector: string;
  nodes: CssDeclaration[];
};

type CssSheet = CssNode & {
  nodes: CssDeclaration[];
  walkRules: (visit: (rule: CssRule) => void) => void;
  walkAtRules: (name: string, visit: (rule: CssSheet) => void) => void;
};

// 使用 Vite 已安装的 PostCSS；不展开层，也不模拟浏览器级联。
const require = createRequire(import.meta.resolve("vite/package.json"));
const { parse }: { parse: (source: string) => CssSheet } = require("postcss");

export function readCss(name: string) {
  return readFileSync(`src/kit/styles/${name}`, "utf8");
}

export function loadCss(name: string) {
  return parse(readCss(name));
}

export function cssFiles() {
  return readdirSync("src/kit/styles").filter((name) => name.endsWith(".css"));
}

export function rules(sheet: CssSheet) {
  const result: CssRule[] = [];
  sheet.walkRules((rule) => {
    result.push(rule);
  });
  return result;
}

export function atRules(sheet: CssSheet, name: string) {
  const result: CssSheet[] = [];
  sheet.walkAtRules(name, (rule) => {
    result.push(rule);
  });
  return result;
}

export function ancestors(node: CssNode) {
  const result: CssNode[] = [];
  for (let parent = node.parent; parent; parent = parent.parent)
    result.push(parent);
  return result;
}

export function declarations(node: {
  nodes: CssDeclaration[];
}): Record<string, string> {
  return Object.fromEntries(
    node.nodes
      .filter((child) => child.type === "decl")
      .map(({ prop, value }) => [prop, value]),
  );
}

export function findRule(sheet: CssSheet, selector: string) {
  const normalize = (value: string) => value.replace(/\s+/g, "");
  const rule = rules(sheet).find(
    (candidate) => normalize(candidate.selector) === normalize(selector),
  );
  if (!rule) throw new Error(`Missing CSS rule: ${selector}`);
  return rule;
}

export function tokensFor(mode: "light" | "dark") {
  const sheet = loadCss("tokens.css");
  return {
    ...declarations(findRule(sheet, ":root")),
    ...(mode === "dark" ? declarations(findRule(sheet, ".dark")) : {}),
  };
}

export function resolveToken(
  tokens: Record<string, string>,
  name: string,
): string {
  const value = tokens[name];
  if (!value) throw new Error(`Missing token: ${name}`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? resolveToken(tokens, alias[1]) : value;
}

// WCAG 的 sRGB 相对亮度公式；这里只计算不透明令牌，不测最终像素。
export function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    if (!/^#[\da-f]{6}$/i.test(hex))
      throw new Error(`Expected opaque sRGB: ${hex}`);
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const light = luminance(foreground);
  const dark = luminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

export const textPairs = [
  ["foreground", "background"],
  ["foreground", "chrome"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["sidebar-primary", "sidebar-accent"],
  ["selection-foreground", "selection"],
  ["brand", "background"],
  ...["primary", "primary-hover", "primary-active"].map((background) => [
    "primary-foreground",
    background,
  ]),
  ...[
    "background",
    "card",
    "popover",
    "muted",
    "accent",
    "sidebar",
    "sidebar-accent",
  ].map((background) => ["muted-foreground", background]),
  ...["destructive", "success", "warning", "info"].flatMap((status) => [
    [`${status}-foreground`, status],
    [status, `${status}-soft`],
    [status, "background"],
    [status, "card"],
  ]),
  ["destructive-foreground", "destructive-hover"],
];
