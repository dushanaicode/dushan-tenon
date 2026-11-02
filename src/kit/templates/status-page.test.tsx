import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Button } from "../ui/button";
import { StatusPage } from "./status-page";

it.each([
  ["empty", "暂无内容", "还没有可显示的内容"],
  ["error", "出错了", undefined],
  ["forbidden", "没有权限", "请联系管理员，或切换账号"],
  ["notFound", "页面不存在", "请检查地址是否正确"],
  ["loading", "正在加载…", undefined],
] as const)("%s 使用默认文案和页面占位", (kind, title, description) => {
  const { container } = renderKit(<StatusPage kind={kind} className="mt-2" />);
  expect(screen.getByText(title)).toBeTruthy();
  if (description) expect(screen.getByText(description)).toBeTruthy();
  const root = container.firstElementChild;
  expect(root?.getAttribute("data-slot")).toBe("status-page");
  expect(root?.classList.contains("min-h-64")).toBe(true);
  expect(root?.classList.contains("py-panel")).toBe(kind !== "loading");
  expect(root?.classList.contains("mt-2")).toBe(true);
  expect(container.querySelector("main")).toBeNull();
});

it.each([
  ["empty", "lucide-inbox"],
  ["forbidden", "lucide-lock"],
  ["notFound", "lucide-search-x"],
] as const)("%s 使用约定图标并接受文案和操作覆盖", (kind, icon) => {
  const onAction = vi.fn();
  const { container } = renderKit(
    <StatusPage
      kind={kind}
      title={<strong>自定义标题</strong>}
      description={<span>自定义说明</span>}
      action={<Button onClick={onAction}>返回列表</Button>}
    />,
  );
  expect(screen.getByText("自定义标题").tagName).toBe("STRONG");
  expect(screen.getByText("自定义说明")).toBeTruthy();
  expect(container.querySelector(`.${icon}`)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
  expect(onAction).toHaveBeenCalledOnce();
});

it("错误复用 ErrorView，显示追踪 ID 并透传重试状态", () => {
  const onRetry = vi.fn();
  const props = {
    kind: "error" as const,
    title: "加载失败",
    description: "请稍后再试",
    traceId: "trace-123",
    onRetry,
  };
  const { rerender } = renderKit(<StatusPage {...props} />);
  expect(screen.getByRole("alert").getAttribute("data-slot")).toBe(
    "error-view",
  );
  expect(screen.getByRole("heading", { name: "加载失败" })).toBeTruthy();
  expect(screen.getByText("请稍后再试")).toBeTruthy();
  expect(screen.getByText("追踪 ID：trace-123")).toBeTruthy();
  const retry = screen.getByRole("button", { name: "重试" });
  fireEvent.click(retry);
  expect(onRetry).toHaveBeenCalledOnce();
  rerender(<StatusPage {...props} retrying />);
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  expect(retry.querySelector('[data-slot="spinner"]')).not.toBeNull();
  fireEvent.click(retry);
  expect(onRetry).toHaveBeenCalledOnce();
  rerender(<StatusPage kind="error" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText("追踪 ID：trace-123")).toBeNull();
});

it("加载根节点播报忙碌状态，允许覆盖标题和说明", () => {
  const { container } = renderKit(
    <StatusPage kind="loading" title="正在连接" description="请稍候" />,
  );
  const status = screen.getByRole("status");
  expect(status).toBe(container.firstElementChild);
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByText("正在连接")).toBeTruthy();
  expect(screen.getByText("请稍候")).toBeTruthy();
  expect(
    status
      .querySelector('[data-slot="loading"]')
      ?.parentElement?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(status.getAttribute("aria-label")).toBe("正在连接");
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

it("加载富文本标题保留节点与唯一播报根", () => {
  renderKit(<StatusPage kind="loading" title={<strong>正在连接</strong>} />);
  expect(screen.getByText("正在连接").tagName).toBe("STRONG");
  expect(screen.getByRole("status").textContent).toBe("正在连接");
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
});

it.each([
  ["empty", "Nothing here yet"],
  ["error", "Something went wrong"],
  ["forbidden", "No permission"],
  ["notFound", "Page not found"],
  ["loading", "Loading…"],
] as const)("%s 的默认标题随语言变化", async (kind, title) => {
  const { i18n } = renderKit(<StatusPage kind={kind} />);
  await act(() => i18n.changeLanguage("en-US"));
  expect(screen.getByText(title)).toBeTruthy();
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
