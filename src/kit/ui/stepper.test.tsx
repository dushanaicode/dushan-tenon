import { act, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Stepper, type StepperStep } from "./stepper";

function renderStepper(ui: ReactNode) {
  return render(ui, { wrapper: ({ children }) => withKitI18n(children) });
}

const steps: readonly StepperStep[] = [
  { id: "select", label: "选择数据" },
  { id: "configure", label: "配置" },
  { id: "confirm", label: "确认" },
];

it("有序列表带名称，当前步骤、已完成勾及文字可辨识", () => {
  renderStepper(
    <Stepper steps={steps} current={1} label="导入步骤" className="mt-2" />,
  );
  const list = screen.getByRole("list", { name: "导入步骤" });
  expect(list.tagName).toBe("OL");
  expect(list.getAttribute("data-slot")).toBe("stepper");
  expect(list.classList.contains("mt-2")).toBe(true);
  const rows = within(list).getAllByRole("listitem");
  expect(rows[0].getAttribute("aria-current")).toBeNull();
  expect(rows[1].getAttribute("aria-current")).toBe("step");
  expect(rows[2].getAttribute("aria-current")).toBeNull();
  expect(rows[0].querySelector("svg")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  expect(
    within(rows[0]).getByText("已完成").classList.contains("sr-only"),
  ).toBe(true);
  expect(within(rows[1]).getByText("2").classList.contains("bg-primary")).toBe(
    true,
  );
  expect(
    within(rows[2]).getByText("3").classList.contains("border-border"),
  ).toBe(true);
  const lines = list.querySelectorAll('[data-slot="stepper-connector"]');
  expect(lines).toHaveLength(2);
  expect(lines[0].classList.contains("bg-primary")).toBe(true);
  expect(lines[1].classList.contains("bg-border")).toBe(true);
});

it.each([
  [-5, 0],
  [5, 2],
])("current=%s 夹取到 %s", (current, expected) => {
  renderStepper(<Stepper steps={steps} current={current} label="导入步骤" />);
  const rows = screen.getAllByRole("listitem");
  expect(rows[expected].getAttribute("aria-current")).toBe("step");
  expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(screen.queryAllByText("已完成")).toHaveLength(expected);
});

it("窄容器仅显示当前标签，其他标签可读屏，长标签截断", () => {
  renderStepper(<Stepper steps={steps} current={1} label="导入步骤" />);
  const list = screen.getByRole("list", { name: "导入步骤" });
  expect(list.classList.contains("@container")).toBe(true);
  for (const row of within(list).getAllByRole("listitem")) {
    expect(row.classList.contains("min-w-0")).toBe(true);
  }
  for (const [index, step] of steps.entries()) {
    const label = screen.getByText(step.label);
    expect(label.classList.contains("sr-only")).toBe(index !== 1);
    expect(label.classList.contains("@sm:not-sr-only")).toBe(index !== 1);
    expect(label.classList.contains("sm:not-sr-only")).toBe(false);
    expect(label.classList.contains("truncate")).toBe(true);
  }
});

it("完成状态文案随语言切换", async () => {
  const i18n = createKitTestI18n();
  render(
    withKitI18n(<Stepper steps={steps} current={1} label="导入步骤" />, i18n),
  );
  expect(screen.getByText("已完成")).toBeTruthy();
  await act(() => i18n.changeLanguage("en-US"));
  expect(screen.getByText("Completed").classList.contains("sr-only")).toBe(
    true,
  );
});

it("空步骤数组保留列表语义，不虚构当前步骤", () => {
  renderStepper(<Stepper steps={[]} current={0} label="导入步骤" />);
  expect(screen.getByRole("list", { name: "导入步骤" })).toBeTruthy();
  expect(screen.queryAllByRole("listitem")).toEqual([]);
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
});
