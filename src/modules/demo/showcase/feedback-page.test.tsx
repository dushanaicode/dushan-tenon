import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import "@/core/core.test-support";
import { toast } from "@/kit";
import catalog from "./catalog/feedback.json";
import * as module1 from "./examples/alert";
import source1 from "./examples/alert.tsx?raw";
import * as module4 from "./examples/empty-state";
import source4 from "./examples/empty-state.tsx?raw";
import * as module5 from "./examples/error-view";
import source5 from "./examples/error-view.tsx?raw";
import * as module3 from "./examples/loading";
import source3 from "./examples/loading.tsx?raw";
import * as module6 from "./examples/loading-styles";
import source6 from "./examples/loading-styles.tsx?raw";
import * as module2 from "./examples/progress";
import source2 from "./examples/progress.tsx?raw";
import * as module0 from "./examples/toast";
import source0 from "./examples/toast.tsx?raw";
import { FeedbackPage, feedbackExamples } from "./pages/feedback-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => vi.restoreAllMocks());

test("seven live blocks use the catalog's exact rendered modules and source bytes", async () => {
  const spies = [
    vi.spyOn(module0, "ToastExample"),
    vi.spyOn(module1, "AlertExample"),
    vi.spyOn(module2, "ProgressExample"),
    vi.spyOn(module3, "LoadingExample"),
    vi.spyOn(module4, "EmptyStateExample"),
    vi.spyOn(module5, "ErrorViewExample"),
    vi.spyOn(module6, "LoadingStylesExample"),
  ];
  const sources = [
    source0,
    source1,
    source2,
    source3,
    source4,
    source5,
    source6,
  ];
  const view = render(
    <MemoryRouter>
      <FeedbackPage />
    </MemoryRouter>,
  );
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  expect(new Set(catalog.map((entry) => entry.exampleFile))).toEqual(
    new Set(feedbackExamples.map((example) => example.file)),
  );
  for (const [index, example] of feedbackExamples.entries()) {
    expect(sources[index]).toBe(readFileSync(example.file, "utf8"));
    expect((await example.load?.())?.default).toBe(sources[index]);
    expect(spies[index]).toHaveBeenCalled();
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(sources.length),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
});

test("toast events retain an equivalent persistent result", () => {
  const success = vi.spyOn(toast, "success");
  const error = vi.spyOn(toast, "error");
  render(<module0.ToastExample />);
  fireEvent.click(screen.getByRole("button", { name: "成功 Toast" }));
  expect(success).toHaveBeenCalledWith("演示标记已添加到本页");
  expect(screen.getByRole("status").textContent).toBe("演示标记已添加到本页");
  fireEvent.click(screen.getByRole("button", { name: "错误 Toast" }));
  expect(error).toHaveBeenCalledWith("演示操作被拒绝，尚未添加标记");
  fireEvent.click(screen.getByRole("button", { name: "普通 Toast" }));
  expect(screen.getByRole("status").textContent).toBe(
    "这里只演示提示，不修改设置",
  );
  toast.dismiss();
});

test("固定加载组件提供区块与整页两种尺寸", () => {
  render(<module6.LoadingStylesExample />);
  expect(
    screen.getAllByRole("status").map((node) => node.dataset.size),
  ).toEqual(["block", "page"]);
  expect(screen.queryByRole("button")).toBeNull();
  for (const status of screen.getAllByRole("status"))
    expect(status.getAttribute("aria-busy")).toBe("true");
});

test("progress uses actual totals, unknown has no numeric value, and completion disables advancing", () => {
  render(<module2.ProgressExample />);
  const known = screen.getByRole("progressbar", { name: "已知分片进度" });
  const unknown = screen.getByRole("progressbar", {
    name: "正在等待虚构任务返回总量，进度未知",
  });
  expect(known.getAttribute("aria-valuenow")).toBe("50");
  expect(unknown.hasAttribute("aria-valuenow")).toBe(false);
  const advance = screen.getByRole("button", { name: "完成下一个分片" });
  fireEvent.click(advance);
  fireEvent.click(advance);
  expect(known.getAttribute("aria-valuenow")).toBe("100");
  expect(advance).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "从零开始" }));
  expect(known.getAttribute("aria-valuenow")).toBe("0");
});

test("loading, empty and error states each recover through their real local action", () => {
  const loading = render(<module3.LoadingExample />);
  expect(loading.container.querySelector('[aria-busy="true"]')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "模拟加载完成" }));
  expect(screen.getByRole("status").textContent).toContain("摘要已加载");
  expect(loading.container.querySelector('[data-slot="skeleton"]')).toBeNull();
  loading.unmount();
  const empty = render(<module4.EmptyStateExample />);
  expect(screen.getByText(/当前演示集合为空/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "创建虚构记录" }));
  expect(screen.getByRole("status").textContent).toContain("已创建虚构记录");
  empty.unmount();
  const error = render(<module5.ErrorViewExample />);
  expect(screen.getByRole("alert").textContent).toContain("读取开关被设为失败");
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  expect(error.container.querySelector('[data-slot="error-view"]')).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("读取已恢复");
  fireEvent.click(screen.getByRole("button", { name: "重播失败状态" }));
  expect(screen.getByRole("alert")).toBeTruthy();
});
