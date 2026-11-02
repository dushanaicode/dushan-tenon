import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FormField } from "./form-field";
import { Label } from "./label";
import { Slider } from "./slider";

describe("Slider", () => {
  it("使用可见 Label，透传 id、name、ref 和原生表单值", () => {
    const ref = createRef<HTMLInputElement>();
    const { container } = render(
      <form>
        <Label htmlFor="volume">音量</Label>
        <Slider id="volume" name="volume" defaultValue={40} ref={ref} />
      </form>,
    );
    const input = screen.getByRole<HTMLInputElement>("slider", {
      name: "音量",
    });
    expect(screen.getByLabelText("音量")).toBe(input);
    expect(ref.current).toBe(input);
    expect(input.type).toBe("range");
    expect(input.getAttribute("data-slot")).toBe("slider");
    const form = container.querySelector("form") as HTMLFormElement;
    expect(new FormData(form).get("volume")).toBe("40");
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(input.getAttribute("role")).toBeNull();
    expect(input.getAttribute("tabindex")).toBeNull();
  });

  it("FormField 关联可见标签、说明与可选 aria-valuetext", () => {
    render(
      <FormField label="音量" description="调整播放音量">
        {(control) => (
          <Slider {...control} defaultValue={40} aria-valuetext="音量 40%" />
        )}
      </FormField>,
    );
    const input = screen.getByRole("slider", { name: "音量" });
    expect(screen.getByLabelText("音量")).toBe(input);
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByText("调整播放音量").id,
    );
    expect(input.getAttribute("aria-valuetext")).toBe("音量 40%");
  });

  it.each([
    [10, 20, 2, 14],
    [-1, 1, 0.25, 0.5],
    [0, 1, "any", 0.42],
  ])("保留原生 min=%s、max=%s、step=%s 与值", (min, max, step, value) => {
    render(
      <FormField label="范围">
        {(control) => (
          <Slider
            {...control}
            min={min}
            max={max}
            step={step}
            defaultValue={value}
          />
        )}
      </FormField>,
    );
    const input = screen.getByRole<HTMLInputElement>("slider");
    expect([input.min, input.max, input.step, input.value]).toEqual(
      [min, max, step, value].map(String),
    );
  });

  it.each([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ])("原生步进键 %s 保持焦点、冒泡并且不阻止默认动作", (key) => {
    const onKeyDown = vi.fn();
    render(
      <FormField label="步进">
        {(control) => (
          <Slider
            {...control}
            min={10}
            max={90}
            step={5}
            defaultValue={40}
            onKeyDown={onKeyDown}
          />
        )}
      </FormField>,
    );
    const input = screen.getByRole<HTMLInputElement>("slider");
    act(() => input.focus());
    expect(document.activeElement).toBe(input);
    expect(fireEvent.keyDown(input, { key })).toBe(true);
    expect(fireEvent.keyUp(input, { key })).toBe(true);
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onKeyDown.mock.calls[0][0].defaultPrevented).toBe(false);
    // happy-dom 不实现 range 的键盘默认动作或 stepUp/stepDown；
    // 不伪造步进实现。真实数值变化、端点与 Page 键由 Chrome 验收。
    expect([input.type, input.min, input.max, input.step]).toEqual([
      "range",
      "10",
      "90",
      "5",
    ]);
  });

  it("非受控值随原生 input 事件更新，回调仅一次，重渲染不重置", () => {
    const onChange = vi.fn();
    function Example() {
      return (
        <FormField label="音量">
          {(control) => (
            <Slider {...control} defaultValue={40} onChange={onChange} />
          )}
        </FormField>
      );
    }
    const { rerender } = render(<Example />);
    const input = screen.getByRole<HTMLInputElement>("slider");
    fireEvent.input(input, { target: { value: "65" } });
    expect(input.valueAsNumber).toBe(65);
    expect(onChange).toHaveBeenCalledOnce();
    rerender(<Example />);
    expect(input.valueAsNumber).toBe(65);
  });

  it("受控值由调用方回写，支持外部值变化与拒绝输入", () => {
    function Example() {
      const [value, setValue] = useState(40);
      return (
        <FormField label="音量">
          {(control) => (
            <Slider
              {...control}
              value={value}
              onChange={(event) => setValue(event.currentTarget.valueAsNumber)}
            />
          )}
        </FormField>
      );
    }
    const onChange = vi.fn();
    const { rerender } = render(<Example />);
    let input = screen.getByRole<HTMLInputElement>("slider");
    fireEvent.input(input, { target: { value: "60" } });
    expect(input.valueAsNumber).toBe(60);
    rerender(
      <>
        <Label htmlFor="controlled">音量</Label>
        <Slider id="controlled" value={25} onChange={onChange} />
      </>,
    );
    input = screen.getByRole<HTMLInputElement>("slider");
    expect(input.valueAsNumber).toBe(25);
    fireEvent.input(input, { target: { value: "80" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(input.valueAsNumber).toBe(25);
  });

  it("disabled 保留值、不可聚焦且不产生键盘输入回调", () => {
    const onChange = vi.fn();
    render(
      <FormField label="禁用">
        {(control) => (
          <Slider {...control} disabled defaultValue={40} onChange={onChange} />
        )}
      </FormField>,
    );
    const input = screen.getByRole<HTMLInputElement>("slider");
    expect(input.disabled).toBe(true);
    act(() => input.focus());
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(input.valueAsNumber).toBe(40);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.classList.contains("disabled:cursor-not-allowed")).toBe(true);
  });

  it("真实 input 消费令牌、两像素焦点环和系统色，不引入自定义值状态或包装节点", () => {
    const { container } = render(<Slider className="w-72" aria-label="样式" />);
    const input = screen.getByRole<HTMLInputElement>("slider");
    expect(container.children).toHaveLength(1);
    expect(input.children).toHaveLength(0);
    expect(input.style.length).toBe(0);
    expect(input.classList.contains("w-full")).toBe(false);
    for (const name of [
      "w-72",
      "accent-primary",
      "[&::-webkit-slider-runnable-track]:bg-muted",
      "[&::-webkit-slider-thumb]:bg-primary",
      "focus-visible:outline-2",
      "focus-visible:outline-solid",
      "focus-visible:outline-ring",
      "focus-visible:outline-offset-2",
      "forced-colors:accent-[Highlight]",
      "forced-colors:[&::-webkit-slider-runnable-track]:bg-[Canvas]",
      "forced-colors:[&::-webkit-slider-thumb]:bg-[Highlight]",
    ])
      expect(input.classList.contains(name), name).toBe(true);
    expect(input.className).not.toMatch(/appearance-none|transition|animate/);
  });
});
