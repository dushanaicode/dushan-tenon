import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("套件工具类合并", () => {
  it.each([
    ["text-body text-foreground", "text-body text-foreground"],
    ["text-sm text-body", "text-body"],
    ["text-body text-sm", "text-sm"],
    ["leading-6 text-body", "text-body"],
    ["h-control h-8", "h-8"],
    ["h-8 h-control", "h-control"],
    ["p-panel p-4", "p-4"],
    ["gap-stack gap-4", "gap-4"],
    ["shadow-card shadow-popover", "shadow-popover"],
    ["text-foreground text-brand", "text-brand"],
  ])("%s → %s", (input, expected) => {
    expect(cn(input)).toBe(expected);
  });
});
