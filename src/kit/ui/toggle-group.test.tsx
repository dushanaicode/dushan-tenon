import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

// @ts-expect-error type 必须由调用方显式指定
const missingType = <ToggleGroup />;
void missingType;

it("single 空值 / 选中与取消，方向键跳过禁用；公开真实钩子", async () => {
  const change = vi.fn();
  render(
    <ToggleGroup
      type="single"
      defaultValue="a"
      onValueChange={change}
      aria-label="对齐"
    >
      <ToggleGroupItem value="a">甲</ToggleGroupItem>
      <ToggleGroupItem value="disabled" disabled>
        禁用
      </ToggleGroupItem>
      <ToggleGroupItem value="b">乙</ToggleGroupItem>
    </ToggleGroup>,
  );
  const a = screen.getByRole("radio", { name: "甲" });
  const b = screen.getByRole("radio", { name: "乙" });
  expect(a.getAttribute("aria-checked")).toBe("true");
  expect(a.closest('[data-kit="toggle-group"]')?.getAttribute("role")).toBe(
    "radiogroup",
  );
  act(() => a.focus());
  fireEvent.keyDown(a, { key: "ArrowRight" });
  await waitFor(() => expect(document.activeElement).toBe(b));
  fireEvent.keyDown(b, { key: "Home" });
  await waitFor(() => expect(document.activeElement).toBe(a));
  fireEvent.keyDown(a, { key: "End" });
  await waitFor(() => expect(document.activeElement).toBe(b));
  fireEvent.keyDown(b, { key: "Enter" });
  fireEvent.click(b);
  expect(b.getAttribute("aria-checked")).toBe("true");
  expect(change).toHaveBeenLastCalledWith("b");
  fireEvent.click(b);
  expect(change).toHaveBeenLastCalledWith("");
  fireEvent.click(screen.getByRole("radio", { name: "禁用" }));
  expect(change).toHaveBeenCalledTimes(2);
  expect(b.dataset.slot).toBe("toggle-group-item");
});
it("multiple 受控回写与非颜色提示、强制色彩及长中文约束", () => {
  const change = vi.fn();
  const view = (value: string[]) => (
    <ToggleGroup type="multiple" value={value} onValueChange={change}>
      <ToggleGroupItem value="a">长中文标题</ToggleGroupItem>
      <ToggleGroupItem value="b">乙</ToggleGroupItem>
    </ToggleGroup>
  );
  const { rerender } = render(view(["a"]));
  const a = screen.getByRole("button", { name: "长中文标题" });
  const b = screen.getByRole("button", { name: "乙" });
  expect(a.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(b, { key: " " });
  fireEvent.click(b);
  expect(change).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
  expect(b.getAttribute("aria-pressed")).toBe("false");
  rerender(view(["a", "b"]));
  expect(b.getAttribute("aria-pressed")).toBe("true");
  for (const cls of [
    "min-h-control",
    "break-words",
    "data-[state=on]:font-bold",
    "data-[state=on]:outline-2",
    "forced-colors:data-[state=on]:bg-[Highlight]!",
    "forced-colors:data-[state=on]:text-[HighlightText]!",
  ])
    expect(a.classList.contains(cls), cls).toBe(true);
});
