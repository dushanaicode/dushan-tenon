import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Alert } from "./alert";

function renderAlert(children: ReactNode, language = "zh-CN") {
  return render(withKitI18n(children, createKitTestI18n(language)));
}

describe("Alert", () => {
  it.each([
    ["info", "status", "info", "info"],
    ["success", "status", "circle-check", "success"],
    ["warning", "alert", "triangle-alert", "warning"],
    ["danger", "alert", "circle-alert", "destructive"],
  ] as const)(
    "%s 提供正确 role、图标、数据属性、标题与描述",
    (tone, role, icon, token) => {
      renderAlert(
        <Alert tone={tone} title={`${tone} 标题`}>
          <p>可读描述</p>
        </Alert>,
      );
      const alert = screen.getByRole(role, { name: `${tone} 标题` });
      expect(alert.getAttribute("data-slot")).toBe("alert");
      expect(alert.getAttribute("data-tone")).toBe(tone);
      const title = alert.querySelector("[data-slot=alert-title]");
      const description = alert.querySelector("[data-slot=alert-description]");
      expect(alert.getAttribute("aria-labelledby")).toBe(title?.id);
      expect(alert.getAttribute("aria-describedby")).toBe(description?.id);
      expect(description?.textContent).toBe("可读描述");
      expect(within(alert).getByText("可读描述").tagName).toBe("P");
      const svg = alert.querySelector("svg");
      expect(svg?.classList.contains(`lucide-${icon}`)).toBe(true);
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("focusable")).toBe("false");
      for (const name of [
        `border-${token}`,
        `bg-${token}-soft`,
        `text-${token}`,
      ]) {
        expect(alert.classList.contains(name), name).toBe(true);
      }
      expect(within(alert).queryByRole("button")).toBeNull();
    },
  );

  it("默认 info，无标题时支持调用方提供读屏名称与可见描述", () => {
    renderAlert(<Alert aria-label="信息提示">信息：无需保存。</Alert>);
    const alert = screen.getByRole("status", { name: "信息提示" });
    expect(alert.getAttribute("data-tone")).toBe("info");
    expect(alert.querySelector("[data-slot=alert-title]")).toBeNull();
    expect(alert.hasAttribute("aria-labelledby")).toBe(false);
    expect(alert.getAttribute("aria-describedby")).toBe(
      within(alert).getByText("信息：无需保存。").id,
    );
  });

  it("多个实例有独立的标题与描述关联，透传 ref、id、className 和外部名称", () => {
    const ref = createRef<HTMLDivElement>();
    renderAlert(
      <>
        <span id="external">外部名称</span>
        <Alert
          id="first"
          ref={ref}
          title="一"
          aria-labelledby="external"
          className="p-6"
        >
          描述一
        </Alert>
        <Alert title="二">描述二</Alert>
      </>,
    );
    const first = screen.getByRole("status", { name: "外部名称" });
    const second = screen.getByRole("status", { name: "二" });
    expect(ref.current).toBe(first);
    expect(first.id).toBe("first");
    expect(first.classList.contains("p-6")).toBe(true);
    expect(first.classList.contains("p-4")).toBe(false);
    const ids = [first, second].flatMap((alert) =>
      [...alert.querySelectorAll("[id]")].map((element) => element.id),
    );
    expect(new Set(ids).size).toBe(4);
  });

  it.each([
    ["zh-CN", "关闭"],
    ["en-US", "Close"],
  ] as const)(
    "关闭按钮使用 kit Button 与 %s 可访问名称，由调用方处理关闭",
    (language, name) => {
      const onDismiss = vi.fn();
      const onSubmit = vi.fn((event) => event.preventDefault());
      renderAlert(
        <form onSubmit={onSubmit}>
          <Alert title="提示" onDismiss={onDismiss}>
            说明
          </Alert>
        </form>,
        language,
      );
      const alert = screen.getByRole("status", { name: "提示" });
      const button = within(alert).getByRole<HTMLButtonElement>("button", {
        name,
      });
      expect(button.type).toBe("button");
      expect(button.classList.contains("size-control")).toBe(true);
      expect(button.querySelector("svg")?.classList.contains("lucide-x")).toBe(
        true,
      );
      fireEvent.click(button);
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole("status", { name: "提示" })).toBe(alert);
    },
  );

  it("系统高对比颜色作用于真实提示面，文字和图标不依赖颜色", () => {
    renderAlert(
      <Alert tone="warning" title="警告">
        离开前请保存。
      </Alert>,
    );
    const alert = screen.getByRole("alert", { name: "警告" });
    for (const name of [
      "forced-colors:border-[CanvasText]",
      "forced-colors:bg-[Canvas]",
      "forced-colors:text-[CanvasText]",
    ]) {
      expect(alert.classList.contains(name)).toBe(true);
    }
    expect(alert.textContent).toBe("警告离开前请保存。");
    expect(alert.querySelectorAll("svg")).toHaveLength(1);
  });
});
