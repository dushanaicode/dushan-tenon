import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Kbd, KbdGroup } from "./kbd";

it("Kbd 使用 kbd 语义并保留调用方类名", () => {
  render(<Kbd className="px-2">Enter</Kbd>);
  const key = screen.getByText("Enter");
  expect(key.tagName).toBe("KBD");
  expect(key.getAttribute("data-slot")).toBe("kbd");
  for (const name of ["font-mono", "border-border", "bg-muted", "px-2"]) {
    expect(key.classList.contains(name)).toBe(true);
  }
  expect(key.classList.contains("px-1")).toBe(false);
});

it("KbdGroup 包含多个按键", () => {
  const { container } = render(
    <KbdGroup className="gap-2">
      <Kbd>Ctrl</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>,
  );
  const group = container.querySelector('[data-slot="kbd-group"]');
  expect(group?.querySelectorAll('kbd[data-slot="kbd"]')).toHaveLength(2);
  expect(group?.classList.contains("gap-2")).toBe(true);
  expect(group?.textContent).toBe("CtrlK");
});
