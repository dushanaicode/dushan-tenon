import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { applyMode, getSnapshot } from "@/core/appearance-bridge";
import "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import * as contrast from "./contrast";
import { NavigationTreeExample } from "./examples/navigation-tree";
import { WindowControlsExample } from "./examples/window-controls";
import { AppearanceBehaviorPage } from "./pages/appearance-behavior-page";
import { AppearancePage } from "./pages/appearance-page";
import { setupShowcase } from "./showcase.test-support";
import {
  AccessibilityReadings,
  ColorReadings,
  ContrastReadings,
  GeometryReadings,
} from "./standard-readings";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

test("contrast reads actual root colors, keeps unavailable values distinct, and refreshes on a mode change", () => {
  const root = document.documentElement;
  root.style.setProperty("--background", "rgb(255, 255, 255)");
  root.style.setProperty("--foreground", "rgb(0, 0, 0)");
  vi.spyOn(contrast, "toRgba").mockImplementation((color) =>
    color === "rgb(255, 255, 255)"
      ? { r: 255, g: 255, b: 255, a: 1 }
      : { r: 0, g: 0, b: 0, a: 1 },
  );
  render(<ContrastReadings />);
  const row = screen
    .getByRole("rowheader", { name: "--foreground" })
    .closest("tr") as HTMLElement;
  expect(within(row).getByText("21.00:1")).toBeTruthy();
  expect(within(row).getByText("通过")).toBeTruthy();
  expect(
    screen.getAllByText("showcase.readings.unavailable").length,
  ).toBeGreaterThan(0);
  root.style.setProperty("--foreground", "rgb(255, 255, 255)");
  act(() => applyMode("dark"));
  expect(within(row).getByText("1.00:1")).toBeTruthy();
  expect(within(row).getByText("不通过")).toBeTruthy();
});

test("fixed geometry and color values come from current CSS without exposing settings controls", () => {
  document.documentElement.style.setProperty("--r-md", "9px");
  document.documentElement.style.setProperty("--stack-gap", "16px");
  const view = render(
    <>
      <GeometryReadings />
      <ColorReadings />
    </>,
  );
  expect(screen.getByText("9px")).toBeTruthy();
  expect(screen.getByText("16px")).toBeTruthy();
  expect(view.container.querySelectorAll("figure").length).toBeGreaterThan(30);
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("reduced motion and forced colors follow system changes and release subscriptions", () => {
  const reduced = Object.assign(new EventTarget(), {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
  });
  const forced = Object.assign(new EventTarget(), {
    matches: false,
    media: "(forced-colors: active)",
  });
  const removeReduced = vi.spyOn(reduced, "removeEventListener");
  const removeForced = vi.spyOn(forced, "removeEventListener");
  vi.stubGlobal("matchMedia", (query: string) =>
    query.includes("reduced-motion") ? reduced : forced,
  );
  const view = render(<AccessibilityReadings />);
  expect(screen.getByText("no-preference")).toBeTruthy();
  expect(screen.getByText("none")).toBeTruthy();
  act(() => {
    reduced.matches = true;
    forced.matches = true;
    reduced.dispatchEvent(new Event("change"));
    forced.dispatchEvent(new Event("change"));
  });
  expect(screen.getByText("reduce")).toBeTruthy();
  expect(screen.getByText("active")).toBeTruthy();
  view.unmount();
  expect(removeReduced).toHaveBeenCalledWith("change", expect.any(Function));
  expect(removeForced).toHaveBeenCalledWith("change", expect.any(Function));
});

test("window samples provide named controls, disabled states and local maximize/restore feedback", () => {
  render(<WindowControlsExample />);
  const groups = screen.getAllByRole("group");
  expect(
    within(groups[1])
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  fireEvent.click(within(groups[0]).getByRole("button", { name: "最大化" }));
  expect(within(groups[0]).getByRole("button", { name: "还原" })).toBeTruthy();
  fireEvent.click(within(groups[0]).getByRole("button", { name: "还原" }));
  expect(
    within(groups[0]).getByRole("button", { name: "最大化" }),
  ).toBeTruthy();
});

test("local navigation selection, collapse and popup do not navigate the application", async () => {
  render(<NavigationTreeExample />);
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("showcase.navigation.archive") }),
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("showcase.navigation.archive"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("showcase.navigation.library") }),
  );
  expect(screen.queryByRole("button", { name: "草稿" })).toBeNull();
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("showcase.navigation.library") }),
  );
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

test("standard appearance pages mount without any settings or native-window mutation", async () => {
  const before = getSnapshot();
  const view = setupShowcase("/demo/appearance", <AppearancePage />);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(getSnapshot()).toEqual(before);
  expect(
    view.calls.mock.calls.some(([name]) => name === "app_settings_update"),
  ).toBe(false);
  view.unmount();
  const behavior = setupShowcase(
    "/demo/appearance-behavior",
    <AppearanceBehaviorPage />,
  );
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  expect(
    behavior.calls.mock.calls.some(([name]) =>
      [
        "app_window_minimize",
        "app_window_toggle_maximize",
        "app_window_close",
      ].includes(name),
    ),
  ).toBe(false);
});
