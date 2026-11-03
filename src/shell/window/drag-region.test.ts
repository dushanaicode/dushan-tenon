import { afterEach, expect, it, vi } from "vitest";
import { dragRegion, isWindowDragGesture } from "./drag-region";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mouseDown(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    detail: 1,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function header() {
  const element = document.createElement("header");
  element.dataset.windowDrag = "";
  element.style.setProperty("--window-drag-allowed", "1");
  document.body.append(element);
  return element;
}

it("marks the native drag region when the titlebar is hidden", () => {
  expect(dragRegion("hidden")).toEqual({ "data-window-drag": "" });
});

it("adds no attributes when the titlebar is native", () => {
  expect(dragRegion("native")).toEqual({});
});

it("accepts the computed title marker and rejects computed interactive descendants", () => {
  const element = header();
  const title = document.createElement("span");
  const button = document.createElement("button");
  const action = document.createElement("span");
  button.append(action);
  element.append(title, button);
  button.style.setProperty("--window-drag-allowed", "0");
  // Happy DOM omits inherited custom properties from getComputedStyle.
  // Supply the browser CSS boundary; selector/inheritance rules are checked in window-drag.test.ts.
  const computed = getComputedStyle;
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation((target) => {
    if (target === title) return computed(element);
    if (target === action) return computed(button);
    return computed(target);
  });
  expect(isWindowDragGesture(mouseDown(title))).toBe(true);
  expect(isWindowDragGesture(mouseDown(button))).toBe(false);
  expect(isWindowDragGesture(mouseDown(action))).toBe(false);
});

it.each([
  { button: 2, buttons: 2 },
  { button: 1, buttons: 4 },
  { button: 0, buttons: 3 },
  { button: 0, buttons: 0 },
])("rejects non-primary mouse gestures %j", (init) => {
  expect(isWindowDragGesture(mouseDown(header(), init))).toBe(false);
});

it("does not override a child handler or capture ordinary page content", () => {
  const element = header();
  element.addEventListener("mousedown", (event) => event.preventDefault());
  expect(isWindowDragGesture(mouseDown(element))).toBe(false);
  const page = document.createElement("main");
  page.style.setProperty("--window-drag-allowed", "1");
  document.body.append(page);
  expect(isWindowDragGesture(mouseDown(page))).toBe(false);
});

it("includes only the shell's 28px Cocoa padding and not its content", () => {
  const shell = document.createElement("div");
  shell.dataset.shell = "root";
  shell.style.paddingTop = "28px";
  const content = document.createElement("main");
  shell.append(content);
  document.body.append(shell);
  expect(isWindowDragGesture(mouseDown(shell, { clientY: 0 }))).toBe(true);
  expect(isWindowDragGesture(mouseDown(shell, { clientY: 27 }))).toBe(true);
  expect(isWindowDragGesture(mouseDown(shell, { clientY: 28 }))).toBe(false);
  expect(isWindowDragGesture(mouseDown(shell, { clientY: -1 }))).toBe(false);
  expect(isWindowDragGesture(mouseDown(content, { clientY: 12 }))).toBe(false);
  shell.style.paddingTop = "0px";
  expect(isWindowDragGesture(mouseDown(shell, { clientY: 0 }))).toBe(false);
});
