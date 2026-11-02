import { expect, it, vi } from "vitest";
import { APPEARANCE_LAYER_ORDER } from "../styles/layer-order";

// 重复求值整个公共出口；冷缓存转换需要独立于普通交互测试的时间预算。
it("实际 Sonner 注入样式在导入 Toaster 后只包一层，重复求值保持原文", async () => {
  await import("sonner");
  const styles = [...document.head.querySelectorAll("style")].filter((style) =>
    style.textContent.includes("data-sonner-toaster"),
  );
  expect(styles.length).toBeGreaterThan(0);
  const originals = styles.map((style) => style.textContent);
  expect(originals.every((css) => !css.includes("@layer"))).toBe(true);

  for (let evaluation = 0; evaluation < 2; evaluation += 1) {
    vi.resetModules();
    await import("@/kit");
    for (const [index, style] of styles.entries()) {
      expect(style.textContent).toBe(
        `${APPEARANCE_LAYER_ORDER}\n@layer components{${originals[index]}}`,
      );
      expect(style.textContent.startsWith(`${APPEARANCE_LAYER_ORDER}\n`)).toBe(
        true,
      );
      expect(style.textContent.match(/@layer components\{/g)).toHaveLength(1);
      expect(style.textContent.match(/@layer/g)).toHaveLength(2);
    }
  }
}, 15_000);

it("HMR 保留已有层、带前置注释的应用层和无关样式", async () => {
  const css = [
    `\n ${APPEARANCE_LAYER_ORDER}\n@layer components{[data-sonner-toaster]{color:red}}`,
    "/*! Tailwind */\n@layer theme, components;\n@layer components{[data-sonner-toaster]{color:blue}}",
    ".unrelated{color:green}",
  ];
  const styles = css.map((text) => {
    const style = document.createElement("style");
    style.textContent = text;
    document.head.append(style);
    return style;
  });
  try {
    vi.resetModules();
    await import("@/kit");
    expect(styles.map((style) => style.textContent)).toEqual(css);
    expect(styles[1].textContent.length).toBe(css[1].length);
  } finally {
    for (const style of styles) style.remove();
  }
});
