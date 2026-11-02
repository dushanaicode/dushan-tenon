import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Button } from "../ui/button";
import { DetailPage, type DetailTab } from "./detail-page";

const originalResizeObserver = globalThis.ResizeObserver;
const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

const tabs: readonly DetailTab[] = [
  { id: "overview", label: "概览", content: "概览内容" },
  { id: "history", label: "历史", content: "历史内容" },
];

it("返回按钮可选，支持默认与自定义名称和回调", async () => {
  const onBack = vi.fn();
  const { rerender, i18n } = renderKit(<DetailPage title="记录详情" />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<DetailPage title="记录详情" onBack={onBack} />);
  const back = screen.getByRole("button", { name: "返回" });
  expect(back.closest('[data-slot="page-header"]')).not.toBeNull();
  expect(back.classList.contains("size-control")).toBe(true);
  expect(back.classList.contains("hover:bg-accent")).toBe(true);
  expect(back.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(back);
  expect(onBack).toHaveBeenCalledOnce();
  await act(() => i18n.changeLanguage("en-US"));
  expect(screen.getByRole("button", { name: "Back" })).toBe(back);
  rerender(
    <DetailPage title="记录详情" onBack={onBack} backLabel="回到记录列表" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "回到记录列表" }));
  expect(onBack).toHaveBeenCalledTimes(2);
});

it("无标签页时直接呈现内容、页头和操作", () => {
  const { container } = renderKit(
    <DetailPage
      title="记录详情"
      description="查看全部信息"
      actions={<Button>编辑</Button>}
      className="mt-2"
    >
      <p>详情正文</p>
    </DetailPage>,
  );
  const root = container.firstElementChild;
  expect(root?.getAttribute("data-slot")).toBe("detail-page");
  expect(root?.classList.contains("gap-stack")).toBe(true);
  expect(root?.classList.contains("mt-2")).toBe(true);
  expect(screen.getByRole("heading", { name: "记录详情" })).toBeTruthy();
  expect(screen.getByText("查看全部信息")).toBeTruthy();
  expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
  expect(screen.getByText("详情正文").parentElement).toBe(root);
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(container.querySelector("main")).toBeNull();
});

it.each([
  [undefined, "概览", "概览内容"],
  ["history", "历史", "历史内容"],
])("默认标签 %s，概要位于线型标签页之前", (defaultTab, label, content) => {
  const { container } = renderKit(
    <DetailPage title="记录详情" tabs={tabs} defaultTab={defaultTab}>
      <p>概要信息</p>
    </DetailPage>,
  );
  expect(screen.getByRole("tab", { name: label, selected: true })).toBeTruthy();
  expect(screen.getByRole("tabpanel").textContent).toBe(content);
  expect(screen.getByRole("tablist").getAttribute("data-variant")).toBe("line");
  const children = container.firstElementChild?.children;
  expect(children?.[0].getAttribute("data-slot")).toBe("page-header");
  expect(children?.[1]).toBe(screen.getByText("概要信息"));
  expect(children?.[2].getAttribute("data-slot")).toBe("tabs");
  const other = screen.getByRole("tab", {
    name: label === "概览" ? "历史" : "概览",
  });
  fireEvent.mouseDown(other, { button: 0, ctrlKey: false });
  fireEvent.mouseUp(other, { button: 0 });
  fireEvent.click(other);
  expect(other.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe(
    label === "概览" ? "历史内容" : "概览内容",
  );
  expect(screen.queryByText(content as string)).toBeNull();
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
