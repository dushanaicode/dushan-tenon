import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Button } from "./button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";

it("非受控展开、关闭、保留触发焦点与真实 asChild 钩子", () => {
  render(
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button>展开说明</Button>
      </CollapsibleTrigger>
      <CollapsibleContent>完整内容</CollapsibleContent>
    </Collapsible>,
  );
  const trigger = screen.getByRole("button", { name: "展开说明" });
  expect(trigger.dataset).toMatchObject({
    slot: "collapsible-trigger",
    kit: "button",
  });
  expect(trigger.closest('[data-kit="collapsible"]')).not.toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  act(() => trigger.focus());
  // 原生 button 的 Enter / Space 默认动作由浏览器转成 click。
  for (const key of ["Enter", " "]) {
    fireEvent.keyDown(trigger, { key });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe(
      key === "Enter" ? "true" : "false",
    );
    expect(document.activeElement).toBe(trigger);
  }
  expect(screen.queryByText("完整内容")).toBeNull();
});

it("受控 open 仅随回写生效，禁用不请求；内容区可换行且接入减动钩子", () => {
  const change = vi.fn();
  const view = (open: boolean, disabled = false) => (
    <Collapsible open={open} disabled={disabled} onOpenChange={change}>
      <CollapsibleTrigger>说明</CollapsibleTrigger>
      <CollapsibleContent>很长的中文说明</CollapsibleContent>
    </Collapsible>
  );
  const { rerender } = render(view(false));
  fireEvent.click(screen.getByRole("button"));
  expect(change).toHaveBeenCalledExactlyOnceWith(true);
  expect(screen.queryByText("很长的中文说明")).toBeNull();
  rerender(view(true));
  const content = screen.getByText("很长的中文说明");
  expect(content.id).toBe(
    screen.getByRole("button").getAttribute("aria-controls"),
  );
  expect(content.dataset.slot).toBe("collapsible-content");
  expect(content.hasAttribute("data-motion-item")).toBe(true);
  expect(content.classList.contains("kit-collapse")).toBe(true);
  expect(
    content.classList.contains(
      "[--kit-content-height:var(--radix-collapsible-content-height)]",
    ),
  ).toBe(true);
  expect(content.className).toContain("break-words");
  rerender(view(true, true));
  fireEvent.click(screen.getByRole("button"));
  expect(change).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button")).toHaveProperty("disabled", true);
});
