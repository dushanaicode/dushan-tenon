import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import "@/core/core.test-support";
import catalog from "./catalog/buttons.json";
import * as buttonModule from "./examples/button";
import buttonSource from "./examples/button.tsx?raw";
import * as splitModule from "./examples/split-button";
import splitSource from "./examples/split-button.tsx?raw";
import { ButtonsPage, buttonExamples } from "./pages/buttons-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));

test("raw loaders and rendered components come from exactly the same real files", async () => {
  const button = vi.spyOn(buttonModule, "ButtonExample");
  const split = vi.spyOn(splitModule, "SplitButtonExample");
  const view = render(
    <MemoryRouter>
      <ButtonsPage />
    </MemoryRouter>,
  );
  for (const [i, source] of [buttonSource, splitSource].entries()) {
    expect(source).toBe(readFileSync(catalog[i].exampleFile, "utf8"));
    expect((await buttonExamples[i].load?.())?.default).toBe(source);
  }
  await screen.findAllByRole("button", { name: "复制最小示例" });
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual([buttonSource, splitSource]);
  expect(button).toHaveBeenCalled();
  expect(split).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "添加标记 · 0" }));
  expect(screen.getByRole("button", { name: "添加标记 · 1" })).toBeTruthy();
  vi.restoreAllMocks();
});

test("six real variants, icon names, loading exclusion and split arrow semantics", async () => {
  const view = render(
    <MemoryRouter>
      <ButtonsPage />
    </MemoryRouter>,
  );
  const preview = view.container.querySelector(
    '[data-showcase-block="preview"]',
  ) as HTMLElement;
  for (const variant of catalog[0].variants)
    expect(preview.querySelector(`[data-variant="${variant}"]`)).toBeTruthy();
  for (const icon of preview.querySelectorAll('[data-size="icon"]'))
    expect(icon.getAttribute("aria-label")).toBeTruthy();
  const submit = screen.getByRole("button", { name: "模拟提交" });
  vi.useFakeTimers();
  fireEvent.click(submit);
  expect(submit).toHaveProperty("disabled", true);
  expect(submit.getAttribute("aria-busy")).toBe("true");
  await act(() => vi.advanceTimersByTime(1200));
  expect(submit).toHaveProperty("disabled", false);
  vi.useRealTimers();
  fireEvent.pointerDown(screen.getByRole("button", { name: "其它运行方式" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByText("尚未运行")).toBeTruthy();
  fireEvent.click(await screen.findByRole("menuitem", { name: "仅预览" }));
  expect(screen.getByText("预览方式已运行")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "运行" }));
  expect(screen.getByText("默认方式已运行")).toBeTruthy();
  const group = within(screen.getByRole("radiogroup", { name: "视图按钮组" }));
  fireEvent.click(group.getByText("卡片"));
  expect(group.getByText("卡片").getAttribute("data-state")).toBe("on");
});
