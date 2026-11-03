import { compile } from "tailwindcss";
import { expect, it } from "vitest";
import { TIER_BREAKPOINTS } from "../responsive";
import {
  ancestors,
  atRules,
  contrast,
  cssFiles,
  declarations,
  findRule,
  loadCss,
  readCss,
  resolveToken,
  rules,
  textPairs,
  tokensFor,
} from "./styles.test-support";

const themed =
  `background foreground card card-foreground popover popover-foreground
secondary secondary-foreground muted muted-foreground accent accent-foreground
chrome border input scrim primary primary-foreground primary-hover primary-active
brand ring selection selection-foreground destructive destructive-foreground
destructive-soft destructive-hover success success-foreground success-soft
warning warning-foreground warning-soft info info-foreground info-soft sidebar
sidebar-foreground sidebar-accent sidebar-accent-foreground sidebar-border sidebar-primary
scrollbar-thumb elev-card elev-popover`.split(/\s+/);

it("命名容器断点与响应式档位一致且生成查询规则", async () => {
  const mapping = declarations(atRules(loadCss("theme.css"), "theme")[0]);
  const compiler = await compile(
    `${readCss("theme.css")}\n@tailwind utilities;`,
  );
  const css = compiler.build([
    "@medium/content:block",
    "@expanded/shell:block",
    "dark:aria-invalid:ring-destructive/40",
  ]);
  expect(css).toContain(':is(.dark *)[aria-invalid="true"]');
  expect(css).not.toContain("prefers-color-scheme");
  for (const [tier, width] of Object.entries(TIER_BREAKPOINTS)) {
    expect(mapping[`--container-${tier}`]).toBe(`${width}px`);
    expect(css).toContain(
      `@container ${tier === "medium" ? "content" : "shell"} (width >= ${width}px)`,
    );
  }
});

it.each(["light", "dark"] as const)(
  "%s 明确定义整套颜色与表面，引用均有值",
  (mode) => {
    const sheet = loadCss("tokens.css");
    const rule = findRule(sheet, mode === "light" ? ":root" : ".dark");
    const values = declarations(rule);
    expect(ancestors(rule)).toContainEqual(
      expect.objectContaining({ name: "layer", params: "appearance-defaults" }),
    );
    expect(values["color-scheme"]).toBe(mode);
    for (const name of themed) expect(values[`--${name}`], name).toBeTruthy();
    for (const value of Object.values(tokensFor(mode))) {
      for (const [, name] of value.matchAll(/var\((--[\w-]+)\)/g)) {
        expect(resolveToken(tokensFor(mode), name), name).toBeTruthy();
      }
    }
    expect(values["--background"]).toBe(
      mode === "light" ? "#f6f6f7" : "#0f1012",
    );
  },
);

it("固定 Console 几何、字体和图标，不依赖偏好属性", () => {
  expect(tokensFor("light")).toMatchObject({
    "--r-sm": "6px",
    "--r-md": "9px",
    "--r-lg": "12px",
    "--r-xl": "calc(var(--r-lg) + 4px)",
    "--r-control": "var(--r-md)",
    "--r-pill": "var(--r-sm)",
    "--control-h": "36px",
    "--row-h": "46px",
    "--panel-pad": "18px",
    "--stack-gap": "16px",
    "--page-padding": "24px",
    "--content-max-width": "none",
    "--text-body": "14px",
    "--leading-body": "1.5",
    "--icon-size": "18px",
    "--icon-stroke": "2",
  });
  expect(tokensFor("light")["--font-body"]).toMatch(
    /"Segoe UI", "Microsoft YaHei UI", "PingFang SC",\s*system-ui, sans-serif/,
  );
  const icon = declarations(
    findRule(loadCss("icons.css"), ".kit-icon, .kit-icon-control svg.lucide"),
  );
  expect(icon).toMatchObject({
    width: "var(--icon-size)",
    height: "var(--icon-size)",
    "stroke-width": "var(--icon-stroke)",
    "pointer-events": "none",
  });
});

it("Tailwind 颜色、圆角和阴影映射都有对应令牌", () => {
  const mapping = declarations(atRules(loadCss("theme.css"), "theme")[0]);
  const tokens = tokensFor("light");
  for (const name of themed.filter(
    (name) => !["scrollbar-thumb", "elev-card", "elev-popover"].includes(name),
  )) {
    expect(mapping[`--color-${name}`], name).toBe(`var(--${name})`);
  }
  for (const value of Object.values(mapping)) {
    for (const [, name] of value.matchAll(/var\((--[\w-]+)\)/g))
      expect(tokens[name], name).toBeDefined();
  }
  expect(mapping).toMatchObject({
    "--radius-control": "var(--r-control)",
    "--radius-pill": "var(--r-pill)",
    "--shadow-card": "var(--elev-card)",
    "--shadow-popover": "var(--elev-popover)",
    "--font-sans": "var(--font-body)",
  });
});

it("语义工具编译后保留固定几何与 Tailwind 4 独立变换过渡", async () => {
  const compiler = await compile(
    `${readCss("theme.css")}\n@tailwind utilities;`,
  );
  const css = compiler.build([
    "h-control",
    "h-row",
    "p-panel",
    "gap-stack",
    "text-body",
    "motion-transform",
    "after:motion-opacity",
  ]);
  expect(css).toContain("height: var(--control-h)");
  expect(css).toContain("height: var(--row-h)");
  expect(css).toContain("padding: var(--panel-pad)");
  expect(css).toContain("gap: var(--stack-gap)");
  expect(css).toContain("font-size: var(--text-body)");
  expect(css).toContain(
    "transition-property: transform, translate, rotate, scale",
  );
  expect(css).toContain("transition-property: opacity");
  expect(css).toContain("transition-duration: var(--motion-fast)");
});

it.each(["light", "dark"] as const)(
  "%s 主要文字组合均达到 WCAG AA 4.5:1",
  (mode) => {
    const tokens = tokensFor(mode);
    for (const [foreground, background] of textPairs) {
      const ratio = contrast(
        resolveToken(tokens, `--${foreground}`),
        resolveToken(tokens, `--${background}`),
      );
      expect(
        ratio,
        `${mode}: ${foreground}/${background} = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  },
);

it.each(["light", "dark"] as const)("%s 焦点与输入边界达到 3:1", (mode) => {
  const tokens = tokensFor(mode);
  for (const foreground of ["ring", "input"]) {
    for (const background of [
      "background",
      "card",
      "popover",
      "muted",
      "accent",
      "sidebar",
    ]) {
      expect(
        contrast(
          resolveToken(tokens, `--${foreground}`),
          resolveToken(tokens, `--${background}`),
        ),
        `${foreground}/${background}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

it("强制色彩直接使用系统颜色，不以主题或偏好属性门控", () => {
  const forced = atRules(loadCss("base.css"), "media").find(
    (rule) => rule.params === "(forced-colors: active)",
  );
  expect(forced).toBeDefined();
  if (!forced) throw new Error("Missing forced-colors rules");
  expect(ancestors(forced)).toContainEqual(
    expect.objectContaining({ name: "layer", params: "appearance-a11y" }),
  );
  expect(declarations(findRule(forced, ":root, .dark"))).toMatchObject({
    "--background": "Canvas",
    "--foreground": "CanvasText",
    "--primary": "Highlight",
    "--primary-foreground": "HighlightText",
    "--ring": "Highlight",
    "--elev-card": "none",
  });
  expect(declarations(findRule(forced, "::selection"))).toEqual({
    "background-color": "Highlight",
    color: "HighlightText",
  });
  expect(declarations(findRule(forced, ":focus-visible")).outline).toBe(
    "3px solid Highlight",
  );
});

it("没有外观轴、未消费的图表色或主题特效令牌", () => {
  for (const name of cssFiles()) {
    const source = readCss(name);
    expect(source, name).not.toMatch(
      /data-(?:accent|density|motion|preset|theme-style|theme-pack|follow-system-motion|radius|font-family|font-size|line-height|icon-size|icon-stroke|nav-icons|icon-accent|scrollbar|focus-ring|text-contrast|background|fx)[\s=\]]/,
    );
    expect(source, name).not.toMatch(
      /--(?:chart-|fx-|standard-|palette-|theme-)|--sidebar-(?:primary-foreground|ring)/,
    );
    expect(source, name).not.toContain("prefers-color-scheme");
  }
  expect(rules(loadCss("tokens.css")).map((rule) => rule.selector)).toEqual([
    ":root",
    ".dark",
  ]);
});
