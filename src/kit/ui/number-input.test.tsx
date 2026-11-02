import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { NumberInput, type NumberInputProps } from "./number-input";

function renderNumberInput(ui: ReactNode, i18n = createKitTestI18n()) {
  return render(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}

function Example({
  value: initial = null,
  onValueChange,
  ...props
}: Partial<NumberInputProps>) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      {...props}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

it("有限数字立即回调、保留草稿格式，清空回调 null", () => {
  const change = vi.fn();
  renderNumberInput(<Example onValueChange={change} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  expect(input.type).toBe("text");
  expect(input.inputMode).toBe("decimal");
  fireEvent.change(input, { target: { value: "12.50" } });
  expect(change).toHaveBeenLastCalledWith(12.5);
  expect(input.value).toBe("12.50");
  fireEvent.blur(input);
  expect(input.value).toBe("12.5");
  expect(change).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { value: "" } });
  expect(change).toHaveBeenLastCalledWith(null);
  fireEvent.blur(input);
  expect(input.value).toBe("");
  expect(change).toHaveBeenCalledTimes(2);
});

it.each(["-", "1.", "1e", "Infinity", "非法数字"])(
  "草稿 %s 不回调，失焦恢复当前值",
  (draft) => {
    const change = vi.fn();
    renderNumberInput(<Example value={7} onValueChange={change} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: draft } });
    expect(input.value).toBe(draft);
    expect(change).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe("7");
    expect(change).not.toHaveBeenCalled();
  },
);

it("纯空白输入按清空回调 null，失焦后显示空值", () => {
  const change = vi.fn();
  renderNumberInput(<Example value={7} onValueChange={change} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "   " } });
  expect(change).toHaveBeenCalledExactlyOnceWith(null);
  fireEvent.blur(input);
  expect(input.value).toBe("");
  expect(change).toHaveBeenCalledOnce();
});

it.each([
  ["12.50", 12.5, 10],
  ["-3", -3, 0],
])("输入 %s 不提前夹取，失焦后规范为边界值", (draft, parsed, clamped) => {
  const change = vi.fn();
  renderNumberInput(<Example min={0} max={10} onValueChange={change} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: draft } });
  expect(input.value).toBe(draft);
  expect(change).toHaveBeenLastCalledWith(parsed);
  fireEvent.blur(input);
  expect(input.value).toBe(String(clamped));
  expect(change).toHaveBeenLastCalledWith(clamped);
});

it("步进按钮使用输入框内的半高朴素按钮，不命中整颗按钮样式", () => {
  const { container } = renderNumberInput(<Example />);
  const buttons = container.querySelectorAll(
    '[data-slot="number-input"] button',
  );
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(button.hasAttribute("data-kit")).toBe(false);
    expect(button.classList.contains("h-1/2")).toBe(true);
    // 不带这两个类，typography 的控件 min-height 规则才不会命中步进按钮。
    expect(button.classList.contains("size-control")).toBe(false);
    expect(button.classList.contains("h-control")).toBe(false);
  }
});

it("按钮与方向键按 step 增减、夹取，边界按钮禁用", () => {
  const change = vi.fn();
  renderNumberInput(
    <Example value={0} min={0} max={3} step={2} onValueChange={change} />,
  );
  const input = screen.getByRole("textbox") as HTMLInputElement;
  const increase = screen.getByRole("button", {
    name: "增加",
  }) as HTMLButtonElement;
  const decrease = screen.getByRole("button", {
    name: "减少",
  }) as HTMLButtonElement;
  expect(decrease.disabled).toBe(true);
  expect(increase.tabIndex).toBe(-1);
  expect(decrease.tabIndex).toBe(-1);
  expect(increase.type).toBe("button");
  fireEvent.click(increase);
  expect(input.value).toBe("2");
  fireEvent.click(increase);
  expect(input.value).toBe("3");
  expect(increase.disabled).toBe(true);
  expect(decrease.disabled).toBe(false);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("3");
  expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(false);
  expect(input.value).toBe("1");
  fireEvent.click(decrease);
  expect(input.value).toBe("0");
  expect(decrease.disabled).toBe(true);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(change).toHaveBeenLastCalledWith(0);
});

it.each([
  [undefined, "ArrowUp", 1],
  [undefined, "ArrowDown", -1],
  [5, "ArrowUp", 6],
  [5, "ArrowDown", 5],
])("null 以 min 或 0 为起点：%s / %s", (min, key, expected) => {
  const change = vi.fn();
  renderNumberInput(<Example min={min} onValueChange={change} />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key });
  expect(change).toHaveBeenCalledExactlyOnceWith(expected);
});

it.each([
  [0.1, 0.2, 0.3],
  [0.123, 0.1, 0.223],
  [1e-7, 2e-7, 3e-7],
])("步进 %s + %s 没有浮点尾差", (value, step, expected) => {
  const change = vi.fn();
  renderNumberInput(
    <Example value={value} step={step} onValueChange={change} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "增加" }));
  expect(change).toHaveBeenCalledExactlyOnceWith(expected);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    String(expected),
  );
});

it("外部受控值改变时替换草稿", () => {
  const change = vi.fn();
  const { rerender } = renderNumberInput(
    <NumberInput value={1} onValueChange={change} />,
  );
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "-" } });
  rerender(<NumberInput value={5} onValueChange={change} />);
  expect(input.value).toBe("5");
  rerender(<NumberInput value={null} onValueChange={change} />);
  expect(input.value).toBe("");
  expect(change).not.toHaveBeenCalled();
});

it("禁用输入和按钮，关联属性透传输入框", () => {
  const change = vi.fn();
  renderNumberInput(
    <Example
      value={2}
      disabled
      id="amount"
      aria-invalid
      aria-describedby="amount-error"
      placeholder="数量"
      className="mt-2"
      onValueChange={change}
    />,
  );
  const input = screen.getByRole("textbox") as HTMLInputElement;
  expect(input.disabled).toBe(true);
  expect(input.id).toBe("amount");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe("amount-error");
  expect(input.placeholder).toBe("数量");
  expect(
    input.closest('[data-slot="number-input"]')?.classList.contains("mt-2"),
  ).toBe(true);
  for (const button of screen.getAllByRole("button")) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(change).not.toHaveBeenCalled();
  expect(input.value).toBe("2");
});

it("按钮可访问名称随语言变化", async () => {
  const i18n = createKitTestI18n();
  renderNumberInput(<Example />, i18n);
  expect(screen.getByRole("button", { name: "增加" })).toBeTruthy();
  await act(() => i18n.changeLanguage("en-US"));
  expect(screen.getByRole("button", { name: "Increase" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Decrease" })).toBeTruthy();
});
