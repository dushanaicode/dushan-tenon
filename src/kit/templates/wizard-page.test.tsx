import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { WizardPage, type WizardStep } from "./wizard-page";

const steps: readonly WizardStep[] = [
  { id: "select", label: "选择数据", content: "选择内容" },
  { id: "configure", label: "配置", content: "配置内容" },
  { id: "confirm", label: "确认", content: "确认内容" },
];

it("依次呈现页头、步骤、当前内容和操作，步骤受控且回调参数正确", () => {
  const onCurrentChange = vi.fn();
  const onFinish = vi.fn();
  const props = {
    title: "导入数据",
    description: "分步检查后导入",
    label: "导入步骤",
    steps,
    onCurrentChange,
    onFinish,
    className: "mt-2",
  };
  const { container, rerender } = renderKit(
    <WizardPage {...props} current={0} />,
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root.getAttribute("data-slot")).toBe("wizard-page");
  expect(root.classList.contains("gap-stack")).toBe(true);
  expect(root.classList.contains("mt-2")).toBe(true);
  expect(
    Array.from(root.children, (element) => element.getAttribute("data-slot")),
  ).toEqual([
    "page-header",
    "stepper",
    "wizard-page-content",
    "wizard-page-actions",
  ]);
  expect(screen.getByRole("heading", { name: "导入数据" })).toBeTruthy();
  expect(screen.getByText("分步检查后导入")).toBeTruthy();
  expect(screen.getByRole("list", { name: "导入步骤" })).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText("选择内容").getAttribute("aria-live")).toBe("polite");
  expect(screen.queryByText("配置内容")).toBeNull();
  const previous = screen.getByRole("button", {
    name: "上一步",
  }) as HTMLButtonElement;
  expect(previous.disabled).toBe(true);
  expect(previous.classList.contains("border-input")).toBe(true);
  fireEvent.click(previous);
  expect(onCurrentChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(onCurrentChange).toHaveBeenLastCalledWith(1);
  expect(screen.getByText("选择内容")).toBeTruthy();

  rerender(<WizardPage {...props} current={1} />);
  expect(screen.getByText("配置内容")).toBeTruthy();
  expect(screen.queryByText("选择内容")).toBeNull();
  expect(previous.disabled).toBe(false);
  fireEvent.click(previous);
  expect(onCurrentChange).toHaveBeenLastCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(onCurrentChange).toHaveBeenLastCalledWith(2);

  rerender(<WizardPage {...props} current={2} />);
  expect(screen.getByText("确认内容")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  expect(onFinish).toHaveBeenCalledExactlyOnceWith();
  expect(onCurrentChange).toHaveBeenCalledTimes(3);
  expect(container.querySelector("main")).toBeNull();
});

it.each([
  [0, "下一步"],
  [2, "完成"],
] as const)("canProceed=false 禁用第 %s 步的前进操作", (current, name) => {
  const onCurrentChange = vi.fn();
  const onFinish = vi.fn();
  renderKit(
    <WizardPage
      title="导入"
      label="步骤"
      steps={steps}
      current={current}
      canProceed={false}
      onCurrentChange={onCurrentChange}
      onFinish={onFinish}
    />,
  );
  const button = screen.getByRole("button", { name }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(onCurrentChange).not.toHaveBeenCalled();
  expect(onFinish).not.toHaveBeenCalled();
});

it("pending 完成按钮显示 Spinner，支持自定义完成文案", () => {
  const onFinish = vi.fn();
  renderKit(
    <WizardPage
      title="导入"
      label="步骤"
      steps={steps}
      current={2}
      onCurrentChange={vi.fn()}
      onFinish={onFinish}
      finishLabel="开始导入"
      pending
    />,
  );
  const finish = screen.getByRole("button", {
    name: "开始导入",
  }) as HTMLButtonElement;
  expect(finish.disabled).toBe(true);
  expect(finish.getAttribute("aria-busy")).toBe("true");
  expect(finish.querySelector('[data-slot="spinner"]')).not.toBeNull();
  fireEvent.click(finish);
  expect(onFinish).not.toHaveBeenCalled();
});

it.each([
  [-5, 0, "下一步", 1],
  [5, 2, "上一步", 1],
] as const)(
  "current=%s 夹取到 %s，内容和回调使用夹取值",
  (current, expected, action, next) => {
    const onCurrentChange = vi.fn();
    renderKit(
      <WizardPage
        title="导入"
        label="步骤"
        steps={steps}
        current={current}
        onCurrentChange={onCurrentChange}
        onFinish={vi.fn()}
      />,
    );
    expect(screen.getByText(steps[expected].content as string)).toBeTruthy();
    expect(
      screen.getAllByRole("listitem")[expected].getAttribute("aria-current"),
    ).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(onCurrentChange).toHaveBeenCalledExactlyOnceWith(next);
  },
);

it("导航与完成按钮的默认文案随语言切换", async () => {
  const props = {
    title: "导入",
    label: "步骤",
    steps,
    onCurrentChange: vi.fn(),
    onFinish: vi.fn(),
  };
  const { rerender, i18n } = renderKit(<WizardPage {...props} current={1} />);
  await act(() => i18n.changeLanguage("en-US"));
  expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  rerender(<WizardPage {...props} current={2} />);
  expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
