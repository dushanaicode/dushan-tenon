import { expect, it } from "vitest";
import { tierForWidth } from "./responsive";

it.each([
  [0, "compact"],
  [719, "compact"],
  [720, "medium"],
  [1099, "medium"],
  [1100, "expanded"],
] as const)("%i px belongs to %s", (width, tier) => {
  expect(tierForWidth(width)).toBe(tier);
});
