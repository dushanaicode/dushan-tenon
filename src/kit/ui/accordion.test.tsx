import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion";

// @ts-expect-error type 必须由调用方指定
const missingType = <Accordion />;
void missingType;

function Items() {
  return (
    <>
      {["one", "disabled", "two"].map((value) => (
        <AccordionItem
          key={value}
          value={value}
          disabled={value === "disabled"}
        >
          <AccordionTrigger>{value}</AccordionTrigger>
          <AccordionContent>{value} 内容</AccordionContent>
        </AccordionItem>
      ))}
    </>
  );
}
it("single 非受控、关闭与 disabled 跳过，方向键 / Home / End 保持焦点", async () => {
  render(
    <Accordion type="single" collapsible defaultValue="one">
      <Items />
    </Accordion>,
  );
  const one = screen.getByRole("button", { name: "one" });
  const two = screen.getByRole("button", { name: "two" });
  expect(one.getAttribute("aria-expanded")).toBe("true");
  expect(one.parentElement?.tagName).toBe("H3");
  expect(one.closest('[data-kit="accordion"]')).not.toBeNull();
  act(() => one.focus());
  for (const [key, expected] of [
    ["ArrowDown", two],
    ["Home", one],
    ["End", two],
    ["ArrowUp", one],
  ] as const) {
    fireEvent.keyDown(document.activeElement as Element, { key });
    await waitFor(() => expect(document.activeElement).toBe(expected));
  }
  fireEvent.click(two);
  expect(one.getAttribute("aria-expanded")).toBe("false");
  expect(two.getAttribute("aria-expanded")).toBe("true");
  const region = screen.getByRole("region", { name: "two" });
  expect(region.id).toBe(two.getAttribute("aria-controls"));
  expect(region.dataset.slot).toBe("accordion-content");
  expect(region.hasAttribute("data-motion-item")).toBe(true);
  expect(region.classList.contains("kit-collapse")).toBe(true);
  expect(
    region.classList.contains(
      "[--kit-content-height:var(--radix-accordion-content-height)]",
    ),
  ).toBe(true);
  fireEvent.click(two);
  expect(two.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "disabled" }));
  expect(screen.queryByText("disabled 内容")).toBeNull();
});
it("multiple 受控回写、显式标题层级与长中文", () => {
  const changed = vi.fn();
  const view = (value: string[]) => (
    <Accordion type="multiple" value={value} onValueChange={changed}>
      <AccordionItem value="a">
        <AccordionTrigger headingLevel={2}>很长的中文标题</AccordionTrigger>
        <AccordionContent>甲</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger headingLevel={6}>乙</AccordionTrigger>
        <AccordionContent>乙内容</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
  const { rerender } = render(view(["a"]));
  const a = screen.getByRole("button", { name: "很长的中文标题" });
  const b = screen.getByRole("button", { name: "乙" });
  expect(a.parentElement?.tagName).toBe("H2");
  expect(b.parentElement?.tagName).toBe("H6");
  expect(a.className).toContain("min-w-0");
  expect(a.className).toContain("break-words");
  fireEvent.keyDown(b, { key: " " });
  fireEvent.click(b);
  expect(changed).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
  expect(b.getAttribute("aria-expanded")).toBe("false");
  rerender(view(["a", "b"]));
  expect(screen.getAllByRole("region")).toHaveLength(2);
  expect(
    a.querySelector('[data-slot="accordion-chevron"]')?.getAttribute("class"),
  ).toContain("group-data-[state=open]:rotate-180");
});
