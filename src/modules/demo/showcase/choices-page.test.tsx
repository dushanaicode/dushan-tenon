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
import catalog from "./catalog/choices.json";
import * as example1 from "./examples/checkbox-form";
import source1 from "./examples/checkbox-form.tsx?raw";
import * as example2 from "./examples/radio-group";
import source2 from "./examples/radio-group.tsx?raw";
import * as example0 from "./examples/switch";
import source0 from "./examples/switch.tsx?raw";
import * as example3 from "./examples/toggle-group";
import source3 from "./examples/toggle-group.tsx?raw";
import { ChoicesPage, choicesExamples } from "./pages/choices-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("choices: seven blocks, rendered modules, raw bytes and catalog are the same sources", async () => {
  const spies = [
    vi.spyOn(example0, "SwitchExample"),
    vi.spyOn(example1, "CheckboxFormExample"),
    vi.spyOn(example2, "RadioGroupExample"),
    vi.spyOn(example3, "ToggleGroupExample"),
  ];
  const router = createMemoryRouter([{ path: "*", element: <ChoicesPage /> }], {
    initialEntries: ["/demo/choices"],
  });
  const view = render(<RouterProvider router={router} />);
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  const sources = [source0, source1, source2, source3];
  expect(catalog).toHaveLength(sources.length);
  expect(new Set(catalog.map((entry) => entry.exampleFile)).size).toBe(
    sources.length,
  );
  for (const [i, source] of sources.entries()) {
    expect(source).toBe(readFileSync(catalog[i].exampleFile, "utf8"));
    expect(choicesExamples[i].file).toBe(catalog[i].exampleFile);
    expect((await choicesExamples[i].load?.())?.default).toBe(source);
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(sources.length),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
  for (const spy of spies) expect(spy).toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/demo/choices");
});

test("switch applies immediately; draft checkbox/radio choices submit atomically or cancel", () => {
  render(
    <>
      <example0.SwitchExample />
      <example1.CheckboxFormExample />
    </>,
  );
  fireEvent.click(screen.getByRole("switch", { name: "显示页内辅助提示" }));
  expect(screen.getByText("已生效：提示已开启")).toBeTruthy();
  expect(screen.getByRole("button", { name: "提交选择" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "包含说明" }));
  fireEvent.click(screen.getByRole("radio", { name: "完整资料" }));
  expect(screen.getByText("有未提交的修改")).toBeTruthy();
  expect(
    screen.getByText("已提交：说明 不含；插图 包含；格式 摘要"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
  expect(
    screen
      .getByRole("checkbox", { name: "包含说明" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    screen.getByRole("radio", { name: "摘要" }).getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("checkbox", { name: "包含说明" }));
  fireEvent.click(screen.getByRole("radio", { name: "完整资料" }));
  fireEvent.click(screen.getByRole("button", { name: "提交选择" }));
  expect(
    screen.getByText("已提交：说明 包含；插图 包含；格式 完整资料"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "取消修改" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("radio arrows skip disabled options; single toggle can clear and multiple selections persist", async () => {
  render(
    <>
      <example2.RadioGroupExample />
      <example3.ToggleGroupExample />
    </>,
  );
  const summary = screen.getByRole("radio", { name: "摘要" });
  act(() => summary.focus());
  fireEvent.keyDown(summary, { key: "ArrowDown" });
  await waitFor(() =>
    expect(
      screen
        .getByRole("radio", { name: "完整资料" })
        .getAttribute("aria-checked"),
    ).toBe("true"),
  );
  expect(screen.getByRole("radio", { name: "未开放的格式" })).toHaveProperty(
    "disabled",
    true,
  );
  const single = within(screen.getByRole("radiogroup", { name: "单选视图" }));
  fireEvent.click(single.getByText("列表"));
  expect(screen.getByText("当前视图：未选；已选细节 1 项")).toBeTruthy();
  fireEvent.click(single.getByText("卡片"));
  expect(single.getByText("卡片").querySelector("svg")).toBeTruthy();
  const multiple = within(screen.getByRole("toolbar", { name: "多选细节" }));
  fireEvent.click(multiple.getByText("包含插图"));
  expect(multiple.getByText("包含说明").getAttribute("data-state")).toBe("on");
  expect(multiple.getByText("包含插图").getAttribute("data-state")).toBe("on");
  expect(screen.getByText("当前视图：卡片；已选细节 2 项")).toBeTruthy();
});

test("matrix exposes real mixed checkbox state and all disabled controls stay disabled", () => {
  const view = render(
    <MemoryRouter>
      <ChoicesPage />
    </MemoryRouter>,
  );
  const matrix = within(
    view.container.querySelector(
      '[data-showcase-block="matrix"]',
    ) as HTMLElement,
  );
  const mixed = matrix.getByRole("checkbox", { name: "Checkbox · 不确定" });
  expect(mixed.getAttribute("aria-checked")).toBe("mixed");
  fireEvent.click(mixed);
  expect(mixed.getAttribute("aria-checked")).toBe("true");
  expect(matrix.getByRole("switch", { name: "Switch · 禁用" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    matrix.getByRole("checkbox", { name: "Checkbox · 禁用" }),
  ).toHaveProperty("disabled", true);
  expect(
    matrix.getByRole("radio", { name: "RadioGroup · 禁用" }),
  ).toHaveProperty("disabled", true);
  expect(
    matrix.getByRole("radio", { name: "ToggleGroup · 禁用" }),
  ).toHaveProperty("disabled", true);
});
