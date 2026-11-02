import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

afterEach(() => vi.useRealTimers());

it("150/200ms 默认意图延迟；移入内容取消关闭；Portal 与基础动效", async () => {
  vi.useFakeTimers();
  const { container } = render(
    <HoverCard>
      <HoverCardTrigger href="#preview">预览</HoverCardTrigger>
      <HoverCardContent>很长的中文说明</HoverCardContent>
    </HoverCard>,
  );
  const trigger = screen.getByRole("link", { name: "预览" });
  fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(149));
  expect(screen.queryByText("很长的中文说明")).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  const content = screen.getByText("很长的中文说明");
  expect(container.contains(content)).toBe(false);
  expect(content.dataset).toMatchObject({
    slot: "hover-card-content",
    kit: "hover-card",
    state: "open",
  });
  for (const cls of ["kit-pop", "w-72", "p-4", "shadow-popover", "break-words"])
    expect(content.classList.contains(cls)).toBe(true);
  fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(199));
  expect(screen.queryByText("很长的中文说明")).not.toBeNull();
  fireEvent.pointerEnter(content, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(201));
  expect(screen.queryByText("很长的中文说明")).not.toBeNull();
  fireEvent.pointerLeave(content, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(screen.queryByText("很长的中文说明")).toBeNull();
});
it("焦点打开、Esc 关闭不抢焦点；延迟可覆盖；受控更新由父级决定", async () => {
  vi.useFakeTimers();
  const change = vi.fn();
  const view = (open?: boolean) => (
    <HoverCard open={open} onOpenChange={change} openDelay={10} closeDelay={15}>
      <HoverCardTrigger asChild>
        <a href="#preview">信息</a>
      </HoverCardTrigger>
      <HoverCardContent sideOffset={10}>预览内容</HoverCardContent>
    </HoverCard>
  );
  const { rerender } = render(view());
  const trigger = screen.getByRole("link", { name: "信息" });
  act(() => trigger.focus());
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(screen.getByText("预览内容")).toBeTruthy();
  expect(trigger.dataset.slot).toBe("hover-card-trigger");
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.queryByText("预览内容")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  rerender(view(false));
  fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(change).toHaveBeenLastCalledWith(true);
  expect(screen.queryByText("预览内容")).toBeNull();
  rerender(view(true));
  expect(screen.getByText("预览内容")).toBeTruthy();
});
