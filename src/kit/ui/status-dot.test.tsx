import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatusDot } from "./status-dot";

it.each([
  ["neutral", "bg-muted-foreground"],
  ["info", "bg-primary"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-destructive"],
] as const)("%s 使用对应语义背景色", (tone, background) => {
  render(<StatusDot tone={tone} data-testid="dot" />);
  expect(screen.getByTestId("dot").classList.contains(background)).toBe(true);
});

it("默认 info，为隐藏的装饰性圆点并合并调用方类名", () => {
  render(<StatusDot data-testid="dot" className="ml-2" aria-hidden={false} />);
  const dot = screen.getByTestId("dot");
  expect(dot.tagName).toBe("SPAN");
  expect(dot.getAttribute("data-slot")).toBe("status-dot");
  expect(dot.getAttribute("aria-hidden")).toBe("true");
  for (const name of [
    "inline-block",
    "size-2",
    "shrink-0",
    "rounded-full",
    "bg-primary",
    "ml-2",
  ]) {
    expect(dot.classList.contains(name)).toBe(true);
  }
  expect(dot.classList.contains("kit-pulse")).toBe(false);
  expect(dot.hasAttribute("data-motion-item")).toBe(false);
});

it("仅 running 添加 kit-pulse 和统一关闭标记，停止时一并移除", () => {
  const { rerender } = render(<StatusDot data-testid="dot" running />);
  const dot = screen.getByTestId("dot");
  expect(dot.classList.contains("kit-pulse")).toBe(true);
  expect(dot.hasAttribute("data-motion-item")).toBe(true);

  rerender(<StatusDot data-testid="dot" running={false} />);
  expect(screen.getByTestId("dot")).toBe(dot);
  expect(dot.classList.contains("kit-pulse")).toBe(false);
  expect(dot.hasAttribute("data-motion-item")).toBe(false);
});
