import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Loading } from "./loading";

it.each([undefined, "page"] as const)(
  "size=%s 保留唯一忙碌播报、完整标签与固定旋转图标",
  (size) => {
    const { container } = render(
      withKitI18n(
        <Loading size={size} label="正在读取项目" className="mt-2" />,
      ),
    );
    const status = screen.getByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status).toBe(container.firstElementChild);
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.dataset.size).toBe(size ?? "block");
    expect(status.classList.contains("mt-2")).toBe(true);
    expect(screen.getByText("正在读取项目")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(
      container.querySelectorAll("[style], animate, animateTransform"),
    ).toHaveLength(0);
    const ring = status.querySelector("svg.kit-spin");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect(ring?.hasAttribute("data-motion-item")).toBe(true);
    expect(ring?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(
      screen.getByText("正在读取项目").hasAttribute("data-motion-item"),
    ).toBe(false);
  },
);

it("缺省文案跟随语言，label 覆盖且空标签保持隐藏", async () => {
  const i18n = createKitTestI18n();
  const { rerender } = render(withKitI18n(<Loading />, i18n));
  expect(screen.getByText("加载中")).toBeTruthy();
  await act(() => i18n.changeLanguage("en-US"));
  expect(screen.getByText("Loading")).toBeTruthy();
  rerender(
    withKitI18n(<Loading label="Long label · 正在读取完整项目列表" />, i18n),
  );
  expect(screen.getByText("Long label · 正在读取完整项目列表")).toBeTruthy();
  rerender(withKitI18n(<Loading label="" />, i18n));
  expect(screen.getByRole("status").textContent).toBe("");
});
