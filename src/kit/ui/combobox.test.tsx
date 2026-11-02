import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Combobox, type ComboboxOption, type ComboboxProps } from "./combobox";

function renderCombobox(children: ReactNode) {
  const i18n = createKitTestI18n();
  return { ...render(withKitI18n(children, i18n)), i18n };
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

const options: readonly ComboboxOption[] = [
  { value: "console", label: "控制台", keywords: ["主界面"] },
  { value: "studio", label: "工作室" },
  { value: "paper", label: "纸张", disabled: true },
];

function Example({
  value: initial = null,
  onValueChange,
  ...props
}: Partial<ComboboxProps>) {
  const [value, setValue] = useState(initial);
  return (
    <Combobox
      options={options}
      placeholder="选择预设"
      searchPlaceholder="搜索预设"
      emptyText="没有匹配预设"
      {...props}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

async function open() {
  const trigger = screen.getByRole("combobox");
  fireEvent.click(trigger);
  const search = await screen.findByRole("combobox", { name: "搜索预设" });
  return { trigger, search };
}

it("打开列出选项、展开状态与控件关联属性落在触发器", async () => {
  renderCombobox(
    <Example
      id="preset"
      aria-invalid
      aria-describedby="preset-error"
      className="mt-2"
    />,
  );
  const trigger = screen.getByRole("combobox");
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.id).toBe("preset");
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  expect(trigger.getAttribute("aria-describedby")).toBe("preset-error");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
  expect(trigger.classList.contains("mt-2")).toBe(true);
  expect(
    screen.getByText("选择预设").classList.contains("text-muted-foreground"),
  ).toBe(true);
  const { search } = await open();
  expect(search.getAttribute("placeholder")).toBe("搜索预设");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getAllByRole("option").map((item) => item.textContent)).toEqual(
    ["控制台", "工作室", "纸张"],
  );
  const list = screen.getByRole("listbox");
  expect(search.getAttribute("aria-controls")).toBe(list.id);
  const content = screen.getByRole("dialog");
  expect(trigger.getAttribute("aria-controls")).toBe(content.id);
  expect(content.classList.contains("w-(--radix-popover-trigger-width)")).toBe(
    true,
  );
  expect(content.classList.contains("p-0")).toBe(true);
});

it.each(["控制台", "主界面"])(
  "默认过滤匹配标签和 keywords：%s",
  async (query) => {
    renderCombobox(<Example />);
    const { search } = await open();
    fireEvent.change(search, { target: { value: query } });
    const matches = screen.getAllByRole("option");
    expect(matches).toHaveLength(1);
    expect(matches[0].getAttribute("data-value")).toBe("console");
  },
);

it("选择回调、关闭并恢复焦点，显示已选标签与勾", async () => {
  const change = vi.fn();
  renderCombobox(<Example onValueChange={change} />);
  const { trigger } = await open();
  expect(document.querySelector('[data-slot="combobox-check"]')).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "工作室" }));
  expect(change).toHaveBeenCalledExactlyOnceWith("studio");
  await waitFor(() => {
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  expect(trigger.textContent).toBe("工作室");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await open();
  expect(
    screen
      .getByRole("option", { name: "工作室" })
      .querySelector('[data-slot="combobox-check"]'),
  ).not.toBeNull();
  expect(
    document.querySelectorAll('[data-slot="combobox-check"]'),
  ).toHaveLength(1);
});

it("方向键与 Enter 可以选择，Esc 可以关闭", async () => {
  const change = vi.fn();
  renderCombobox(<Example onValueChange={change} />);
  const { trigger, search } = await open();
  await waitFor(() =>
    expect(screen.getByRole("option", { selected: true }).textContent).toBe(
      "控制台",
    ),
  );
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(change).toHaveBeenCalledExactlyOnceWith("studio");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await open();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  expect(change).toHaveBeenCalledOnce();
});

it("无匹配显示 emptyText", async () => {
  renderCombobox(<Example />);
  const { search } = await open();
  fireEvent.change(search, { target: { value: "不存在的预设" } });
  expect(screen.queryAllByRole("option")).toEqual([]);
  expect(screen.getByText("没有匹配预设")).toBeTruthy();
});

it("顶部清除项回调 null，文案随语言切换", async () => {
  const change = vi.fn();
  const { i18n } = renderCombobox(
    <Example value="console" clearable onValueChange={change} />,
  );
  const { trigger } = await open();
  expect(screen.getAllByRole("option")[0].textContent).toBe("清除选择");
  await act(() => i18n.changeLanguage("en-US"));
  fireEvent.click(screen.getByRole("option", { name: "Clear selection" }));
  expect(change).toHaveBeenCalledExactlyOnceWith(null);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(trigger.textContent).toBe("选择预设");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("disabled 触发器不能打开", () => {
  renderCombobox(<Example disabled />);
  const trigger = screen.getByRole("combobox") as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("禁用选项不可选中", async () => {
  const change = vi.fn();
  renderCombobox(<Example onValueChange={change} />);
  await open();
  const disabled = screen.getByRole("option", { name: "纸张" });
  expect(disabled.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(disabled);
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeTruthy();
});
