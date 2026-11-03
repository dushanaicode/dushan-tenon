import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import "@/core/core.test-support";
import catalog from "./catalog/inputs.json";
import * as example0 from "./examples/form-field";
import source0 from "./examples/form-field.tsx?raw";
import * as example3 from "./examples/number-input";
import source3 from "./examples/number-input.tsx?raw";
import * as example2 from "./examples/range-slider";
import source2 from "./examples/range-slider.tsx?raw";
import * as example1 from "./examples/slider";
import source1 from "./examples/slider.tsx?raw";
import { InputsPage, inputsExamples } from "./pages/inputs-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("inputs: seven blocks, rendered modules, raw bytes and catalog are the same sources", async () => {
  const spies = [
    vi.spyOn(example0, "FormFieldExample"),
    vi.spyOn(example1, "SliderExample"),
    vi.spyOn(example2, "RangeSliderExample"),
    vi.spyOn(example3, "NumberInputExample"),
  ];
  const router = createMemoryRouter([{ path: "*", element: <InputsPage /> }], {
    initialEntries: ["/demo/inputs"],
  });
  const view = render(<RouterProvider router={router} />);
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  const sources = [source0, source1, source2, source3];
  expect(catalog).toHaveLength(sources.length + 2);
  expect(catalog.slice(-2).map((entry) => entry.id)).toEqual([
    "component.setting-group",
    "component.setting-row",
  ]);
  expect(
    catalog
      .slice(-2)
      .every((entry) => entry.exampleFile === catalog[0].exampleFile),
  ).toBe(true);
  expect(
    view.container.querySelector(
      '[data-kit="setting-group"] [data-kit="setting-row"]',
    ),
  ).not.toBeNull();
  expect(new Set(catalog.map((entry) => entry.exampleFile)).size).toBe(
    sources.length,
  );
  for (const [i, source] of sources.entries()) {
    expect(source).toBe(readFileSync(catalog[i].exampleFile, "utf8"));
    expect(inputsExamples[i].file).toBe(catalog[i].exampleFile);
    expect((await inputsExamples[i].load?.())?.default).toBe(source);
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(sources.length),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
  for (const spy of spies) expect(spy).toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/demo/inputs");
});

test("form validation associates real errors and clears them after valid Unicode input", () => {
  render(<example0.FormFieldExample />);
  const name = screen.getByRole("textbox", { name: "片段名称" });
  const description = screen.getByRole("textbox", { name: "片段说明" });
  fireEvent.click(screen.getByRole("button", { name: "校验并提交" }));
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(name.getAttribute("aria-describedby")).toContain(
    screen.getByText("请填写名称。").id || screen.getByRole("alert").id,
  );
  fireEvent.change(name, { target: { value: "很".repeat(13) } });
  expect(screen.getByText("名称最多 12 个 Unicode 字符。")).toBeTruthy();
  fireEvent.change(name, { target: { value: "😀".repeat(12) } });
  fireEvent.change(description, { target: { value: "说明".repeat(21) } });
  expect(name.hasAttribute("aria-invalid")).toBe(false);
  expect(description.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("说明最多 40 个 Unicode 字符。")).toBeTruthy();
  fireEvent.change(description, { target: { value: "虚构资料" } });
  fireEvent.click(screen.getByRole("button", { name: "校验并提交" }));
  expect(screen.getByRole("status").textContent).toContain("校验通过");
});

test("numeric decimals, bounds, null and unit labels preserve numeric values", () => {
  render(<example3.NumberInputExample />);
  const number = screen.getByRole("textbox", { name: "精确数值" });
  fireEvent.keyDown(number, { key: "ArrowUp" });
  expect(number).toHaveProperty("value", "1.6");
  expect(screen.getByRole("status").textContent).toBe("受控值：1.6");
  fireEvent.change(number, { target: { value: "20" } });
  fireEvent.blur(number);
  expect(number).toHaveProperty("value", "3");
  fireEvent.keyDown(number, { key: "ArrowUp" });
  expect(number).toHaveProperty("value", "3");
  fireEvent.change(number, { target: { value: "-2" } });
  fireEvent.blur(number);
  expect(number).toHaveProperty("value", "0");
  fireEvent.change(number, { target: { value: "  " } });
  expect(screen.getByRole("status").textContent).toBe("受控值：null");
  const duration = screen.getByRole("textbox", { name: "持续时间（秒）" });
  fireEvent.keyDown(duration, { key: "ArrowUp" });
  expect(duration).toHaveProperty("value", "2.5");
});

test("native slider reports its value and range keyboard movement respects a two-step gap", () => {
  render(
    <>
      <example1.SliderExample />
      <example2.RangeSliderExample />
    </>,
  );
  const single = screen.getByRole("slider", { name: "示例强度：40%" });
  fireEvent.change(single, { target: { value: "65" } });
  expect(screen.getByRole("slider", { name: "示例强度：65%" })).toHaveProperty(
    "value",
    "65",
  );
  const lower = screen.getByRole("slider", { name: "范围下限" });
  const upper = screen.getByRole("slider", { name: "范围上限" });
  act(() => lower.focus());
  fireEvent.keyDown(lower, { key: "ArrowRight" });
  expect(lower.getAttribute("aria-valuenow")).toBe("25");
  for (let i = 0; i < 12; i++) fireEvent.keyDown(lower, { key: "ArrowRight" });
  expect(
    Number(upper.getAttribute("aria-valuenow")) -
      Number(lower.getAttribute("aria-valuenow")),
  ).toBeGreaterThanOrEqual(10);
  expect(screen.getByText("下限：60")).toBeTruthy();
});

test("matrix read-only/disabled states use supported contracts and errors can be corrected", () => {
  const view = render(
    <MemoryRouter>
      <InputsPage />
    </MemoryRouter>,
  );
  const matrix = within(
    view.container.querySelector(
      '[data-showcase-block="matrix"]',
    ) as HTMLElement,
  );
  expect(matrix.getByRole("textbox", { name: "Input · 只读" })).toHaveProperty(
    "readOnly",
    true,
  );
  expect(
    matrix.getByRole("textbox", { name: "Textarea · 只读" }),
  ).toHaveProperty("readOnly", true);
  expect(
    matrix.getByRole("textbox", { name: "NumberInput · 禁用" }),
  ).toHaveProperty("disabled", true);
  const error = matrix.getByRole("textbox", { name: "Input · 错误" });
  expect(error.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(error, { target: { value: "修正后的虚构资料" } });
  expect(error.hasAttribute("aria-invalid")).toBe(false);
  expect(matrix.getAllByText("此控件无该状态契约；不模拟。")).toHaveLength(5);
});
