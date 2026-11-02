import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatCard } from "./stat-card";

it("渲染标题、节点数值、单位和提示", () => {
  const { container } = render(
    <StatCard
      title="本月额度"
      value={<strong>62</strong>}
      unit="%"
      hint={<span>5 天后重置</span>}
      className="mt-2"
    />,
  );
  expect(screen.getByText("本月额度").classList.contains("text-sm")).toBe(true);
  expect(screen.getByText("62").tagName).toBe("STRONG");
  expect(screen.getByText("%")).toBeTruthy();
  expect(screen.getByText("5 天后重置")).toBeTruthy();
  expect(container.firstElementChild?.getAttribute("data-slot")).toBe(
    "stat-card",
  );
  expect(container.firstElementChild?.classList.contains("mt-2")).toBe(true);
  expect(container.firstElementChild?.getAttribute("data-kit")).toBe("card");
  const valueLine = container.querySelector('[data-part="value-line"]');
  expect(valueLine?.className).toBe("flex items-baseline gap-1");
  expect(screen.getByText("62").parentElement?.parentElement).toBe(valueLine);
  expect(screen.getByText("%").parentElement).toBe(valueLine);
  expect(screen.getByText("本月额度").getAttribute("data-slot")).toBe(
    "card-description",
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it.each([
  [-10, 0],
  [0, 0],
  [62, 62],
  [120, 100],
])("进度 %s 夹取为 %s，名称来自标题", (progress, expected) => {
  render(<StatCard title="本月额度" value={62} progress={progress} />);
  const bar = screen.getByRole("progressbar", { name: "本月额度" });
  expect(bar.getAttribute("aria-valuenow")).toBe(String(expected));
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("100");
});

it.each([
  ["default", "primary"],
  ["success", "success"],
  ["warning", "warning"],
  ["danger", "destructive"],
] as const)("tone=%s 的进度根同时保留 tone 与强制色彩填充类", (tone, fill) => {
  render(<StatCard title="本月额度" value={62} progress={62} tone={tone} />);
  const bar = screen.getByRole("progressbar", { name: "本月额度" });
  // tone 与强制色彩类特异性相同；后者靠生成顺序在后而赢，必须同在根上。
  expect(
    bar.classList.contains(`[&_[data-slot=progress-indicator]]:bg-${fill}`),
  ).toBe(true);
  expect(
    bar.classList.contains(
      "forced-colors:[&_[data-slot=progress-indicator]]:bg-[Highlight]",
    ),
  ).toBe(true);
});

it.each([
  [undefined, "foreground", "primary"],
  ["default", "foreground", "primary"],
  ["success", "success", "success"],
  ["warning", "warning", "warning"],
  ["danger", "destructive", "destructive"],
] as const)("tone=%s 只改变数值和进度条颜色", (tone, color, fill) => {
  const { container } = render(
    <StatCard
      title="本月额度"
      value={62}
      unit="%"
      hint="说明"
      progress={62}
      tone={tone}
    />,
  );
  const value = container.querySelector('[data-slot="stat-card-value"]');
  expect(value?.classList.contains(`text-${color}`)).toBe(true);
  expect(
    screen
      .getByRole("progressbar")
      .classList.contains(`[&_[data-slot=progress-indicator]]:bg-${fill}`),
  ).toBe(true);
  expect(
    screen.getByText("本月额度").classList.contains("text-muted-foreground"),
  ).toBe(true);
  expect(
    screen.getByText("%").classList.contains("text-muted-foreground"),
  ).toBe(true);
  expect(
    screen.getByText("说明").classList.contains("text-muted-foreground"),
  ).toBe(true);
});
