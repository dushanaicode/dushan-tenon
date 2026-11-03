import "./core.test-support";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LazyContent, LoadingContent } from "./lazy-content";

test("LoadingContent 使用页面级 Loading 并保留初始化文案", () => {
  render(<LoadingContent />);
  const status = screen.getByRole("status");
  expect(status.dataset.slot).toBe("loading");
  expect(status.dataset.size).toBe("page");
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(status.textContent).toBe("正在加载设置…");
});

test("lazy content loads only after gate: caches factory identity", async () => {
  const factory = vi.fn(async () => ({ default: () => <p>Loaded content</p> }));
  const view = render(<LazyContent factory={factory} />);
  expect(screen.getByRole("status")).toBeTruthy();
  await screen.findByText("Loaded content");
  view.rerender(<LazyContent factory={factory} />);
  view.unmount();
  render(<LazyContent factory={factory} />);
  await screen.findByText("Loaded content");
  expect(factory).toHaveBeenCalledTimes(1);
});

test("lazy content loads only after gate: retry creates a new lazy promise", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const factory = vi
    .fn()
    .mockRejectedValueOnce(new Error("Import unavailable"))
    .mockResolvedValue({ default: () => <p>Recovered content</p> });
  try {
    render(<LazyContent factory={factory} />);
    const error = await screen.findByRole("alert");
    expect(error.getAttribute("data-slot")).toBe("error-view");
    expect(error.textContent).toContain("内容加载失败");
    expect(error.textContent).toContain("追踪 ID：");
    expect(log).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("Recovered content");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    log.mockRestore();
  }
});
