import {
  act,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Separator,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/kit";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";

function pressSpace(button: HTMLElement) {
  act(() => button.focus());
  const key = { key: " ", code: "Space" };
  const pressed = fireEvent.keyDown(button, key);
  const released = fireEvent.keyUp(button, key);
  // fireEvent 不合成原生按钮的键盘 click；补上未被阻止的浏览器默认动作。
  if (pressed && released) fireEvent.click(button);
}

describe("表单原语", () => {
  it("长文本控件保留完整文案、焦点与文本选择", () => {
    // 无头环境仅验证约束、焦点与可选择性；字形边界和 200% 文字由实机验收。
    const text = "中文 Aa 0123 — A long English label that remains selectable";
    render(
      <>
        <p className="text-body select-text">{text}</p>
        <Button>{text}</Button>
        <Input aria-label="长文本" defaultValue={text} />
        <Textarea aria-label="多行文本" defaultValue={`${text}\n第二行`} />
      </>,
    );
    const input = screen.getByRole("textbox", { name: "长文本" });
    if (!(input instanceof HTMLInputElement)) throw new Error("缺少输入框");
    act(() => {
      input.focus();
      input.select();
    });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(text.length);
    expect(screen.getByRole("button").textContent).toBe(text);
    for (const control of [
      input,
      screen.getByRole("button"),
      screen.getByRole("textbox", { name: "多行文本" }),
    ]) {
      expect(control.classList.contains("text-body")).toBe(true);
      expect(control.className).not.toMatch(/overflow-hidden|truncate/);
    }
  });

  it.each([undefined, "text-sm"])(
    "正文字号与颜色共存，允许调用方覆盖：%s",
    (className) => {
      const { container } = render(
        <>
          <Button className={className}>提交</Button>
          <Input aria-label="输入" className={className} />
          <Textarea aria-label="说明" className={className} />
          <Label className={className}>标签</Label>
          <Tabs defaultValue="first">
            <TabsList>
              <TabsTrigger value="first" className={className}>
                概览
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </>,
      );
      const controls = container.querySelectorAll(
        "button, input, textarea, label",
      );
      expect(controls).toHaveLength(5);
      for (const control of controls) {
        expect(control.classList.contains("text-body")).toBe(
          className === undefined,
        );
        expect(control.classList.contains("text-sm")).toBe(
          className === "text-sm",
        );
      }
      const input = screen.getByRole("textbox", { name: "输入" });
      for (const [control, color] of [
        [screen.getByRole("button"), "text-primary-foreground"],
        [input, "text-foreground"],
        [screen.getByRole("tab"), "text-muted-foreground"],
      ] as const) {
        expect(control.classList.contains(color)).toBe(true);
      }
      expect(input.classList.contains("file:text-body")).toBe(true);
      expect(input.classList.contains("file:text-foreground")).toBe(true);
    },
  );

  it("Input 关联标签并透传输入、ref、type 与 aria-invalid", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(
      <>
        <Label htmlFor="email">邮箱</Label>
        <Input
          id="email"
          type="email"
          ref={ref}
          aria-invalid="true"
          onChange={onChange}
        />
      </>,
    );
    const input = screen.getByLabelText("邮箱") as HTMLInputElement;
    expect(input).toBe(screen.getByRole("textbox", { name: "邮箱" }));
    expect(ref.current).toBe(input);
    expect(input.type).toBe("email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "user@example.com" } });
    expect(input.value).toBe("user@example.com");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("禁用的 Input 保持原值且无法获得输入焦点", () => {
    const onChange = vi.fn();
    render(<Input disabled defaultValue="保留" onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    act(() => input.focus());
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(input, { key: "a", code: "KeyA" });
    fireEvent.keyUp(input, { key: "a", code: "KeyA" });
    expect(input.value).toBe("保留");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Textarea 接收多行输入", () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="说明" onChange={onChange} />);
    const input = screen.getByRole("textbox", {
      name: "说明",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    expect(input.value).toBe("第一行\n第二行");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("Checkbox 点击和空格键切换并返回正确回调值", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="选择" onCheckedChange={onCheckedChange} />);
    const checkbox = screen.getByRole("checkbox", { name: "选择" });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    pressSpace(checkbox);
    expect(document.activeElement).toBe(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
  });

  it("Checkbox 暴露混合状态，禁用后不能切换", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Checkbox checked="indeterminate" onCheckedChange={onCheckedChange} />,
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    onCheckedChange.mockClear();
    rerender(
      <Checkbox
        disabled
        checked="indeterminate"
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(checkbox);
    pressSpace(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("mixed");
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("Switch 点击和空格键切换，禁用后保持状态", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Switch aria-label="通知" onCheckedChange={onCheckedChange} />,
    );
    const control = screen.getByRole("switch", { name: "通知" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    expect(control.getAttribute("aria-checked")).toBe("true");
    pressSpace(control);
    expect(document.activeElement).toBe(control);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
    onCheckedChange.mockClear();
    rerender(
      <Switch disabled aria-label="通知" onCheckedChange={onCheckedChange} />,
    );
    fireEvent.click(control);
    pressSpace(control);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("RadioGroup 用方向键移动并选中，跳过禁用项", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        defaultValue="first"
        orientation="horizontal"
        onValueChange={onValueChange}
        aria-label="选项"
      >
        <RadioGroupItem value="first" aria-label="一" />
        <RadioGroupItem value="second" aria-label="二" disabled />
        <RadioGroupItem value="third" aria-label="三" />
      </RadioGroup>,
    );
    const first = screen.getByRole("radio", { name: "一" });
    const disabled = screen.getByRole("radio", { name: "二" });
    const third = screen.getByRole("radio", { name: "三" });
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.activeElement).toBe(third);
      expect(third.getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.keyUp(third, { key: "ArrowRight" });
    expect(first.getAttribute("aria-checked")).toBe("false");
    expect(disabled.getAttribute("aria-checked")).toBe("false");
    expect(onValueChange).toHaveBeenLastCalledWith("third");
  });

  it("小控件根元素保留扩大的命中区域", () => {
    render(
      <>
        <Checkbox aria-label="选择" />
        <Switch aria-label="开关" />
        <RadioGroup aria-label="选项">
          <RadioGroupItem value="first" aria-label="一" />
        </RadioGroup>
      </>,
    );
    for (const role of ["checkbox", "switch", "radio"]) {
      const classes = screen.getByRole(role).classList;
      for (const name of ["relative", "after:absolute", "after:content-['']"]) {
        expect(classes.contains(name), `${role}: ${name}`).toBe(true);
      }
      const insets =
        role === "switch"
          ? ["after:-inset-x-1", "after:-inset-y-1.5"]
          : ["after:-inset-2"];
      for (const name of insets) {
        expect(classes.contains(name), `${role}: ${name}`).toBe(true);
      }
    }
  });
});

describe("展示原语", () => {
  it.each(["default", "line"] as const)(
    "Tabs %s 支持点击和方向键，只有当前面板内容挂载",
    async (variant) => {
      render(
        <Tabs defaultValue="first">
          <TabsList variant={variant} aria-label="详情">
            <TabsTrigger value="first">概览</TabsTrigger>
            <TabsTrigger value="second">记录</TabsTrigger>
          </TabsList>
          <TabsContent value="first">概览内容</TabsContent>
          <TabsContent value="second">记录内容</TabsContent>
        </Tabs>,
      );
      const first = screen.getByRole("tab", { name: "概览" });
      const second = screen.getByRole("tab", { name: "记录" });
      expect(screen.getByRole("tablist").getAttribute("data-variant")).toBe(
        variant,
      );
      expect(screen.getByRole("tabpanel").textContent).toBe("概览内容");
      expect(screen.queryByText("记录内容")).toBeNull();
      fireEvent.mouseDown(second, { button: 0, ctrlKey: false });
      fireEvent.mouseUp(second, { button: 0 });
      fireEvent.click(second);
      expect(screen.getByRole("tabpanel").textContent).toBe("记录内容");
      expect(screen.queryByText("概览内容")).toBeNull();
      expect(first.getAttribute("aria-selected")).toBe("false");
      expect(second.getAttribute("aria-selected")).toBe("true");
      act(() => second.focus());
      fireEvent.keyDown(second, { key: "ArrowLeft" });
      await waitFor(() => {
        expect(document.activeElement).toBe(first);
        expect(first.getAttribute("aria-selected")).toBe("true");
        expect(screen.getByRole("tabpanel").textContent).toBe("概览内容");
      });
      fireEvent.keyUp(first, { key: "ArrowLeft" });
      expect(screen.queryByText("记录内容")).toBeNull();
    },
  );

  it("Progress 暴露确定值，未知时保留 35% 脉冲且无 aria-valuenow", () => {
    const { rerender } = render(<Progress value={40} />);
    const progress = screen.getByRole("progressbar");
    const indicator = progress.querySelector(
      '[data-slot="progress-indicator"]',
    ) as HTMLElement;
    expect(progress.classList.contains("forced-colors:border")).toBe(true);
    expect(
      progress.classList.contains("forced-colors:border-[CanvasText]"),
    ).toBe(true);
    expect(
      progress.classList.contains(
        "forced-colors:[&_[data-slot=progress-indicator]]:bg-[Highlight]",
      ),
    ).toBe(true);
    expect(indicator.classList.contains("forced-colors:bg-[Highlight]")).toBe(
      false,
    );
    expect(progress.getAttribute("aria-valuenow")).toBe("40");
    expect(indicator.style.transform).toBe(
      "var(--progress-transform, translateX(-60%))",
    );
    expect(indicator.style.getPropertyValue("--progress-visible")).toBe("40%");
    expect(indicator.classList.contains("motion-transform")).toBe(true);
    expect(indicator.classList.contains("kit-pulse")).toBe(false);
    for (const value of [null, undefined]) {
      rerender(<Progress value={value} />);
      expect(progress.hasAttribute("aria-valuenow")).toBe(false);
      expect(indicator.style.transform).toBe(
        "var(--progress-transform, translateX(-65%))",
      );
      expect(indicator.style.getPropertyValue("--progress-visible")).toBe(
        "35%",
      );
      expect(indicator.classList.contains("kit-pulse")).toBe(true);
      expect(indicator.classList.contains("motion-transform")).toBe(false);
    }
  });

  it("Spinner 默认名称跟随语言，允许调用方覆盖", async () => {
    const { rerender } = render(<Spinner />);
    expect(screen.getByRole("status", { name: "加载中" })).toBeTruthy();
    rerender(<Spinner aria-label="正在保存" />);
    expect(screen.getByRole("status", { name: "正在保存" })).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage("en-US");
    });
    expect(screen.getByRole("status", { name: "正在保存" })).toBeTruthy();
    rerender(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });

  it("Separator 默认装饰性，可显式提供分隔语义", () => {
    const { rerender } = render(<Separator />);
    expect(screen.getByRole("none")).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
    rerender(<Separator decorative={false} />);
    expect(screen.getByRole("separator")).toBeTruthy();
  });
});

const i18n = createKitTestI18n();
function render(ui: ReactNode) {
  return renderView(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}

beforeEach(() => {
  void i18n.changeLanguage("zh-CN");
});
