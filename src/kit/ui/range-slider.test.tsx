import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { RangeSlider, type RangeSliderProps } from "./range-slider";

// @ts-expect-error 必须提供两个滑块的名称
const missingLabels = <RangeSlider value={[20, 80]} onValueChange={() => {}} />;
// @ts-expect-error 只接受受控二元组
const uncontrolled: RangeSliderProps = {
  thumbLabels: ["低", "高"],
  onValueChange: () => {},
};
// @ts-expect-error 不是任意长度数组
const three: RangeSliderProps["value"] = [10, 20, 30];
void [missingLabels, uncontrolled, three];

it("触摸轨道定位最近端点，拖动提交受控二元组", () => {
  function Example() {
    const [value, setValue] = useState<[number, number]>([20, 80]);
    return (
      <RangeSlider
        value={value}
        onValueChange={setValue}
        min={0}
        max={100}
        thumbLabels={["下限", "上限"]}
      />
    );
  }
  const { container } = render(<Example />);
  const root = container.querySelector(
    '[data-slot="range-slider"]',
  ) as HTMLElement;
  const rect = vi
    .spyOn(root, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 100, 36));
  const capture = vi.spyOn(root, "hasPointerCapture").mockReturnValue(true);
  try {
    fireEvent.pointerDown(root, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 30,
      clientY: 18,
    });
    expect(
      screen
        .getByRole("slider", { name: "下限" })
        .getAttribute("aria-valuenow"),
    ).toBe("30");
    fireEvent.pointerMove(root, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 40,
      clientY: 18,
    });
    fireEvent.pointerUp(root, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 40,
      clientY: 18,
    });
    expect(
      screen
        .getByRole("slider", { name: "下限" })
        .getAttribute("aria-valuenow"),
    ).toBe("40");
    expect(
      screen
        .getByRole("slider", { name: "上限" })
        .getAttribute("aria-valuenow"),
    ).toBe("80");
  } finally {
    rect.mockRestore();
    capture.mockRestore();
  }
});

it("双端键盘调整、步长、端点和最小间距由 Radix 实现", () => {
  function Example() {
    const [value, setValue] = useState<[number, number]>([20, 80]);
    return (
      <RangeSlider
        value={value}
        onValueChange={setValue}
        min={0}
        max={100}
        step={5}
        minStepsBetweenThumbs={2}
        thumbLabels={["下限", "上限"]}
      />
    );
  }
  render(<Example />);
  const low = screen.getByRole("slider", { name: "下限" });
  const high = screen.getByRole("slider", { name: "上限" });
  act(() => low.focus());
  fireEvent.keyDown(low, { key: "ArrowRight" });
  expect(low.getAttribute("aria-valuenow")).toBe("25");
  fireEvent.keyDown(low, { key: "ArrowDown" });
  expect(low.getAttribute("aria-valuenow")).toBe("20");
  fireEvent.keyDown(low, { key: "Home" });
  expect(low.getAttribute("aria-valuenow")).toBe("0");
  act(() => high.focus());
  fireEvent.keyDown(high, { key: "End" });
  expect(high.getAttribute("aria-valuenow")).toBe("100");
  fireEvent.keyDown(high, { key: "ArrowLeft" });
  expect(high.getAttribute("aria-valuenow")).toBe("95");
  for (let i = 0; i < 20; i++) fireEvent.keyDown(high, { key: "ArrowLeft" });
  expect(high.getAttribute("aria-valuenow")).toBe("10");
  expect(low.getAttribute("aria-valuemin")).toBe("0");
  expect(high.getAttribute("aria-valuemax")).toBe("100");
  expect(document.activeElement).toBe(high);
});
it("受控拒绝、回写与禁用，真实部件 / 命中 / 焦点 / 系统颜色", () => {
  const change = vi.fn();
  const view = (value: readonly [number, number], disabled = false) => (
    <RangeSlider
      value={value}
      onValueChange={change}
      disabled={disabled}
      thumbLabels={["下限", "上限"]}
      className="w-72"
    />
  );
  const { rerender, container } = render(view([20, 80]));
  const low = screen.getByRole("slider", { name: "下限" });
  act(() => low.focus());
  fireEvent.keyDown(low, { key: "ArrowRight" });
  expect(change).toHaveBeenCalledExactlyOnceWith([21, 80]);
  expect(low.getAttribute("aria-valuenow")).toBe("20");
  rerender(view([30, 70]));
  expect(low.getAttribute("aria-valuenow")).toBe("30");
  rerender(view([30, 70], true));
  fireEvent.keyDown(low, { key: "ArrowRight" });
  expect(change).toHaveBeenCalledTimes(1);
  expect(low.hasAttribute("tabindex")).toBe(false);
  const root = container.querySelector(
    '[data-kit="range-slider"]',
  ) as HTMLElement;
  expect(root.dataset.slot).toBe("range-slider");
  for (const cls of ["h-control", "touch-none", "w-72"])
    expect(root.classList.contains(cls)).toBe(true);
  expect(root.className).not.toContain("w-full");
  for (const slot of ["track", "range", "thumb"])
    expect(
      root.querySelector(`[data-slot="range-slider-${slot}"]`),
    ).not.toBeNull();
  expect(low.className).toContain("focus-visible:outline-2");
  expect(low.style.length).toBe(0);
  expect(low.className).toContain("after:-inset-2");
  expect(low.className).toContain("forced-colors:bg-[Highlight]");
  expect(
    root.querySelector('[data-slot="range-slider-track"]')?.className,
  ).toContain("forced-colors:bg-[Canvas]");
});
