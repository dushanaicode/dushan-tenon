import { fireEvent, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  formatShortcut,
  isEditableTarget,
  PALETTE_SHORTCUT,
  type Shortcut,
  useShortcuts,
} from "./shortcuts";

function press(
  target: Element | Window = window,
  init: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    code: "KeyK",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, event);
  return event;
}

it("命中后阻止默认行为并执行，非匹配键不执行", () => {
  const run = vi.fn();
  renderHook(() => useShortcuts([{ keys: PALETTE_SHORTCUT, run }]));
  expect(press().defaultPrevented).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
  expect(press(window, { ctrlKey: false }).defaultPrevented).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});

it("StrictMode 双挂载后一次按键只执行一次，卸载后不再执行", () => {
  const run = vi.fn();
  const { unmount } = renderHook(
    () => useShortcuts([{ keys: PALETTE_SHORTCUT, run }]),
    { wrapper: StrictMode },
  );
  press();
  expect(run).toHaveBeenCalledTimes(1);
  unmount();
  expect(press().defaultPrevented).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});

it("列表变化后移除旧绑定，并使用最新动作", () => {
  const previous = vi.fn();
  const next = vi.fn();
  const { rerender } = renderHook(
    ({ shortcuts }: { shortcuts: Shortcut[] }) => useShortcuts(shortcuts),
    {
      initialProps: { shortcuts: [{ keys: PALETTE_SHORTCUT, run: previous }] },
    },
  );
  rerender({ shortcuts: [{ keys: "$mod+l", run: next }] });
  press();
  press(window, { key: "l", code: "KeyL" });
  expect(previous).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
});

it("输入框内普通绑定禁用，allowInEditable 绑定仍可用", () => {
  const run = vi.fn();
  const input = document.createElement("input");
  document.body.append(input);
  const { rerender } = renderHook(
    ({ allowInEditable }) =>
      useShortcuts([{ keys: PALETTE_SHORTCUT, allowInEditable, run }]),
    { initialProps: { allowInEditable: false } },
  );
  try {
    input.focus();
    expect(press(input).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    rerender({ allowInEditable: true });
    expect(press(input).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    input.remove();
  }
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "输入法事件 %j 不执行，即使允许在编辑区触发",
  (event) => {
    const run = vi.fn();
    renderHook(() =>
      useShortcuts([{ keys: PALETTE_SHORTCUT, allowInEditable: true, run }]),
    );
    expect(press(window, event).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  },
);

describe("isEditableTarget", () => {
  it.each(["input", "textarea", "select"])("识别 %s", (tag) => {
    expect(isEditableTarget(document.createElement(tag))).toBe(true);
  });

  it.each(["textbox", "combobox", "searchbox"])(
    "识别 role=%s 及其后代",
    (role) => {
      const parent = document.createElement("div");
      parent.setAttribute("role", role);
      const child = parent.appendChild(document.createElement("span"));
      expect(isEditableTarget(parent)).toBe(true);
      expect(isEditableTarget(child)).toBe(true);
    },
  );

  it.each(["", "true", "plaintext-only"])(
    "识别 contenteditable=%s 及其后代，尊重 false 边界",
    (value) => {
      const parent = document.createElement("div");
      parent.setAttribute("contenteditable", value);
      const child = parent.appendChild(document.createElement("span"));
      expect(isEditableTarget(parent)).toBe(true);
      expect(isEditableTarget(child)).toBe(true);
      child.setAttribute("contenteditable", "false");
      expect(isEditableTarget(child)).toBe(false);
    },
  );

  it("非编辑元素、空目标和 window 不属于编辑区", () => {
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

it.each([
  ["Win32", "$mod+Shift+k", "Ctrl Shift K"],
  ["MacIntel", "$mod+Shift+k", "⌘ ⇧ K"],
  ["Macintosh", "Control+Alt+Meta+k", "⌃ ⌥ ⌘ K"],
  ["Win32", "Control+Alt+k", "Ctrl Alt K"],
  ["Win32", "g k", "G K"],
])("%s 上的 %s 显示为 %s", (platform, keys, expected) => {
  expect(formatShortcut(keys, platform)).toBe(expected);
});
