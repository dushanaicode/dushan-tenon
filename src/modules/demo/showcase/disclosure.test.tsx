import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import "@/core/core.test-support";
import { AccordionExample } from "./examples/accordion";
import { CollapsibleExample } from "./examples/collapsible";

test("controlled collapsible retains focus and disabled trigger cannot expand", () => {
  render(
    <>
      <CollapsibleExample />
      <AccordionExample />
    </>,
  );
  const trigger = screen.getByRole("button", { name: "切换补充说明" });
  trigger.focus();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByText("已展开")).toBeTruthy();
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  const disabled = screen.getByRole("button", { name: "不可展开的区域" });
  expect(disabled).toHaveProperty("disabled", true);
  fireEvent.click(disabled);
  expect(disabled.getAttribute("aria-expanded")).toBe("false");
});

test("accordion single/multiple state, heading levels, long labels and arrow/Home/End navigation", async () => {
  render(
    <>
      <CollapsibleExample />
      <AccordionExample />
    </>,
  );
  const tokens = screen.getByRole("button", { name: "为何使用语义令牌？" });
  const motion = screen.getByRole("button", { name: "何时减少动态效果？" });
  expect(tokens.closest("h5")).toBeTruthy();
  fireEvent.click(tokens);
  fireEvent.click(motion);
  expect(tokens.getAttribute("aria-expanded")).toBe("false");
  expect(motion.getAttribute("aria-expanded")).toBe("true");
  tokens.focus();
  fireEvent.keyDown(tokens, { key: "ArrowDown" });
  await waitFor(() => expect(document.activeElement).toBe(motion));
  fireEvent.keyDown(motion, { key: "Home" });
  await waitFor(() => expect(document.activeElement).toBe(tokens));
  fireEvent.keyDown(tokens, { key: "End" });
  await waitFor(() => expect(document.activeElement).toBe(motion));
  const keyboard = screen.getByRole("button", { name: "怎样用键盘移动？" });
  const long = screen.getByRole("button", { name: /^这是一条用于检查窄窗/ });
  fireEvent.click(keyboard);
  fireEvent.click(long);
  expect(keyboard.getAttribute("aria-expanded")).toBe("true");
  expect(long.getAttribute("aria-expanded")).toBe("true");
  expect(long.textContent?.length).toBeGreaterThan(30);
  const disabled = screen.getByRole("button", { name: "暂不可用的章节" });
  expect(disabled).toHaveProperty("disabled", true);
  keyboard.focus();
  fireEvent.keyDown(keyboard, { key: "End" });
  await waitFor(() => expect(document.activeElement).toBe(long));
});
