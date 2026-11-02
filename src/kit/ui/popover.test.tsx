import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { Button } from "./button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "./popover";

it("点击打开、Esc 关闭并返回焦点，内容使用套件动效", async () => {
  render(
    <Popover>
      <PopoverAnchor className="mt-2">定位点</PopoverAnchor>
      <PopoverTrigger asChild>
        <Button>打开浮层</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="编辑条件">
        <input aria-label="条件" />
      </PopoverContent>
    </Popover>,
  );
  const trigger = screen.getByRole("button", { name: "打开浮层" });
  expect(trigger.getAttribute("data-slot")).toBe("popover-trigger");
  expect(screen.getByText("定位点").getAttribute("data-slot")).toBe(
    "popover-anchor",
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  const content = await screen.findByRole("dialog", { name: "编辑条件" });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(content.getAttribute("data-slot")).toBe("popover-content");
  expect(content.hasAttribute("data-motion-item")).toBe(true);
  for (const name of ["kit-pop", "w-72", "p-4", "shadow-popover"]) {
    expect(content.classList.contains(name)).toBe(true);
  }
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("textbox")),
  );
  fireEvent.keyDown(content, { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("内容宽度与内边距可覆盖", async () => {
  render(
    <Popover defaultOpen>
      <PopoverTrigger>打开</PopoverTrigger>
      <PopoverContent className="w-96 p-0" aria-label="信息">
        内容
      </PopoverContent>
    </Popover>,
  );
  const content = await screen.findByRole("dialog", { name: "信息" });
  expect(content.classList.contains("w-96")).toBe(true);
  expect(content.classList.contains("p-0")).toBe(true);
  expect(content.classList.contains("w-72")).toBe(false);
  expect(content.classList.contains("p-4")).toBe(false);
});
