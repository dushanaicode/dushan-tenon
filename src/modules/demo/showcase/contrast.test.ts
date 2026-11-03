import { expect, it } from "vitest";
import { composite, contrastRatio, type Rgb } from "./contrast";

const white: Rgb = { r: 255, g: 255, b: 255 };
const black: Rgb = { r: 0, g: 0, b: 0 };

it.each([
  [black, white, 21],
  [white, white, 1],
  [{ r: 118, g: 118, b: 118 }, white, 4.54],
  [{ r: 119, g: 119, b: 119 }, white, 4.48],
])("WCAG 已知对比度 %j / %j = %s", (a, b, ratio) => {
  expect(contrastRatio(a, b)).toBeCloseTo(ratio, 2);
});

it("交换前景与背景保持对称，保留原始精度", () => {
  const gray = { r: 118, g: 118, b: 118 };
  expect(contrastRatio(gray, white)).toBe(contrastRatio(white, gray));
  expect(contrastRatio(gray, white)).not.toBe(4.54);
});

it("透明色先合成到真实底面，再计算 sRGB 对比度", () => {
  const foreground = { ...black, a: 0.5 };
  const onWhite = composite(foreground, white);
  expect(onWhite).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  expect(contrastRatio(onWhite, white)).toBeCloseTo(3.9767, 4);
  expect(composite(foreground, black)).toEqual(black);
  expect(composite({ ...black, a: 0 }, white)).toEqual(white);
  expect(composite({ ...black, a: 1 }, white)).toEqual(black);
});
