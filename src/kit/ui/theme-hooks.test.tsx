import {
  act,
  fireEvent,
  render as renderView,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { createRef } from "react";
import { MemoryRouter, NavLink } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import {
  Badge,
  Button,
  ButtonFace,
  Checkbox,
  Combobox,
  Icon,
  Input,
  NumberInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/kit";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";

// face 不应把尺寸、命中区、焦点或状态样式移入内层。
const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 kit-icon-control [&_svg]:pointer-events-none [&_svg]:shrink-0";
const variants = {
  default:
    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
  outline: "border border-input bg-card text-card-foreground hover:bg-accent",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
  link: "text-brand underline-offset-4 hover:underline",
} as const;

it.each(Object.keys(variants) as (keyof typeof variants)[])(
  "%s 的两种尺寸保留基点根样式，图标和文字只进入一个 face",
  (variant) => {
    const { rerender } = render(<Button />);
    for (const size of ["default", "icon"] as const) {
      rerender(
        <Button variant={variant} size={size}>
          <Icon iconId="selected" />
          提交
        </Button>,
      );
      const button = screen.getByRole("button", { name: "提交" });
      expect(button.dataset).toMatchObject({ kit: "button", variant, size });
      expect(button.className).toBe(
        `${buttonBase} ${variants[variant]} ${size === "default" ? "h-control px-4 py-2" : "size-control"}`,
      );
      expect(button.children).toHaveLength(1);
      const face = button.firstElementChild;
      expect(face?.tagName).toBe("SPAN");
      expect(face?.getAttribute("data-part")).toBe("face");
      expect(face?.childNodes).toHaveLength(2);
      expect(face?.firstElementChild?.tagName).toBe("svg");
      expect(face?.hasAttribute("tabindex")).toBe(false);
      expect(button.querySelector('[data-part="overlay"]')).toBeNull();
    }
  },
);

it("默认钩子、ref、提交与禁用忙碌状态仍属于原生按钮根", () => {
  const ref = createRef<HTMLButtonElement>();
  const submit = vi.fn((event) => event.preventDefault());
  const click = vi.fn();
  const view = (disabled: boolean) => (
    <form onSubmit={submit}>
      <Button
        ref={ref}
        type="submit"
        disabled={disabled}
        aria-busy={disabled}
        onClick={click}
      >
        {disabled && <Spinner aria-hidden="true" />}
        保存
      </Button>
    </form>
  );
  const { rerender } = render(view(false));
  const button = screen.getByRole("button", { name: "保存" });
  expect(ref.current).toBe(button);
  expect(button.dataset).toMatchObject({
    kit: "button",
    variant: "default",
    size: "default",
  });
  act(() => button.focus());
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(submit).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  rerender(view(true));
  expect(button).toHaveProperty("disabled", true);
  expect(button.getAttribute("type")).toBe("submit");
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(
    button.querySelector('[data-part="face"] > [data-slot="spinner"]'),
  ).not.toBeNull();
  fireEvent.click(button);
  expect(submit).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
});

it("Tooltip Trigger + asChild NavLink 的真实链接保留 face、overlay、ref 与活动状态", async () => {
  const ref = createRef<HTMLAnchorElement>();
  const click = vi.fn((event) => event.preventDefault());
  const key = vi.fn();
  render(
    <MemoryRouter initialEntries={["/target"]}>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" overlay={<span>2</span>}>
            <NavLink ref={ref} to="/target" onClick={click} onKeyDown={key}>
              <ButtonFace>
                <Icon iconId="home" />
                目标
              </ButtonFace>
            </NavLink>
          </Button>
        </TooltipTrigger>
        <TooltipContent>目标说明</TooltipContent>
      </Tooltip>
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "目标 2" });
  expect(ref.current).toBe(link);
  expect(link.getAttribute("href")).toBe("/target");
  expect(link.getAttribute("aria-current")).toBe("page");
  expect(link.dataset).toMatchObject({
    kit: "button",
    slot: "tooltip-trigger",
    variant: "ghost",
    size: "default",
  });
  expect(
    Array.from(link.children, (child) => [
      child.tagName,
      child.getAttribute("data-part"),
    ]),
  ).toEqual([
    ["SPAN", "face"],
    ["SPAN", "overlay"],
  ]);
  expect(link.querySelector("button")).toBeNull();
  expect(
    link.querySelector('[data-part="face"] [data-part="overlay"]'),
  ).toBeNull();
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  fireEvent.click(link.firstElementChild as Element);
  fireEvent.keyDown(link, { key: "Enter" });
  expect(click).toHaveBeenCalledOnce();
  expect(key).toHaveBeenCalledOnce();
});

it("Combobox 派生 slot 保留按钮身份、截断标签、两端对齐与 Portal 选项", async () => {
  const change = vi.fn();
  render(
    <Combobox
      options={[{ value: "a", label: "长选项" }]}
      value="a"
      onValueChange={change}
      placeholder="选择"
      searchPlaceholder="搜索"
      emptyText="无结果"
    />,
  );
  const trigger = screen.getByRole("combobox");
  expect(trigger.dataset).toMatchObject({
    kit: "button",
    slot: "combobox",
    variant: "outline",
    size: "default",
  });
  expect(trigger.classList.contains("w-full")).toBe(true);
  expect(trigger.classList.contains("justify-between")).toBe(true);
  expect(screen.getByText("长选项").parentElement).toBe(
    trigger.firstElementChild,
  );
  expect(screen.getByText("长选项").classList.contains("truncate")).toBe(true);
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: "长选项" });
  expect(trigger.contains(option)).toBe(false);
  fireEvent.click(option);
  expect(change).toHaveBeenCalledWith("a");
});

it.each([
  [undefined, "neutral", "bg-muted text-muted-foreground"],
  ["neutral", "neutral", "bg-muted text-muted-foreground"],
  ["primary", "primary", "bg-primary text-primary-foreground"],
  ["info", "info", "bg-info-soft text-info"],
  ["success", "success", "bg-success-soft text-success"],
  ["warning", "warning", "bg-warning-soft text-warning"],
  ["danger", "danger", "bg-destructive-soft text-destructive"],
] as const)("Badge tone=%s 真实落点与令牌配对", (tone, expected, colors) => {
  render(<Badge tone={tone}>重点项目</Badge>);
  const badge = screen.getByText("重点项目");
  expect(badge.dataset).toMatchObject({ slot: "badge", tone: expected });
  expect(badge.className).toBe(
    `inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${colors}`,
  );
});

it("表单沿用可见控件的 slot、Indicator/Thumb、隐藏提交节点与命中区", async () => {
  const { container } = render(
    <form>
      <Input name="text" defaultValue="原值" aria-label="文本" aria-invalid />
      <Textarea name="description" defaultValue="多行" aria-label="说明" />
      <NumberInput value={3} onValueChange={vi.fn()} />
      <Checkbox name="check" defaultChecked aria-label="复选" />
      <Switch name="switch" defaultChecked aria-label="开关" />
      <RadioGroup name="radio" defaultValue="one" aria-label="单选组">
        <RadioGroupItem value="one" aria-label="单选" />
      </RadioGroup>
      <Select name="select" defaultValue="one">
        <SelectTrigger aria-label="选择">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">第一项</SelectItem>
        </SelectContent>
      </Select>
    </form>,
  );
  expect(screen.getByRole("textbox", { name: "文本" }).dataset.slot).toBe(
    "input",
  );
  expect(screen.getByRole("textbox", { name: "说明" }).dataset.slot).toBe(
    "textarea",
  );
  expect(
    container.querySelector('[data-slot="number-input"] > [data-slot="input"]'),
  ).not.toBeNull();
  for (const [role, slot, part] of [
    ["checkbox", "checkbox", "checkbox-indicator"],
    ["switch", "switch", "switch-thumb"],
    ["radio", "radio-group-item", "radio-group-indicator"],
  ]) {
    const control = screen.getByRole(role);
    expect(control.dataset.slot).toBe(slot);
    expect(control.dataset.state).toBe("checked");
    expect(control.querySelector(`[data-slot="${part}"]`)).not.toBeNull();
    expect(control.classList.contains("after:absolute")).toBe(true);
    expect(
      control.classList.contains(
        role === "switch" ? "after:-inset-y-1.5" : "after:-inset-2",
      ),
    ).toBe(true);
  }
  expect(
    Array.from(
      new FormData(container.querySelector("form") as HTMLFormElement),
    ),
  ).toEqual([
    ["text", "原值"],
    ["description", "多行"],
    ["check", "on"],
    ["switch", "on"],
    ["radio", "one"],
    ["select", "one"],
  ]);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "选择" }), {
    key: "ArrowDown",
  });
  const option = await screen.findByRole("option", { name: "第一项" });
  expect(option.dataset).toMatchObject({
    slot: "select-item",
    state: "checked",
  });
  expect(
    option.querySelector('[data-slot="select-item-indicator"]'),
  ).not.toBeNull();
  expect(document.querySelector('[data-slot="select-content"]')).not.toBeNull();
  expect(container.contains(option)).toBe(false);
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
