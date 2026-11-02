import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { DashboardPage, type DashboardStat } from "./dashboard-page";

const stats: readonly DashboardStat[] = [
  { id: "quota", title: "额度", value: 62, unit: "%", progress: 62 },
  { id: "running", title: "运行中", value: 2 },
  { id: "success", title: "已完成", value: 10, tone: "success" },
  { id: "failed", title: "失败", value: 1, hint: "请检查", tone: "danger" },
];

it("渲染页头、响应式统计网格，主体位于统计之后", () => {
  const { container } = renderKit(
    <DashboardPage
      title="总览"
      description="当前状态"
      actions={<Button>刷新</Button>}
      stats={stats}
      className="mt-2"
    >
      <Card>最近动态</Card>
    </DashboardPage>,
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root.getAttribute("data-slot")).toBe("dashboard-page");
  expect(root.classList.contains("gap-stack")).toBe(true);
  expect(root.classList.contains("mt-2")).toBe(true);
  expect(screen.getByRole("heading", { name: "总览" })).toBeTruthy();
  expect(screen.getByText("当前状态")).toBeTruthy();
  expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
  const grid = root.querySelector('[data-slot="dashboard-page-stats"]');
  for (const name of [
    "grid-cols-1",
    "@min-[560px]/content:grid-cols-2",
    "@min-[960px]/content:grid-cols-3",
  ]) {
    expect(grid?.classList.contains(name), name).toBe(true);
  }
  expect(grid?.querySelectorAll('[data-slot="stat-card"]')).toHaveLength(4);
  const values = grid?.querySelectorAll('[data-slot="stat-card-value"]');
  expect(Array.from(values ?? [], (value) => value.textContent)).toEqual([
    "62",
    "2",
    "10",
    "1",
  ]);
  expect(Array.from(values ?? [], (value) => value.childElementCount)).toEqual([
    0, 0, 0, 0,
  ]);
  expect(screen.getByRole("progressbar", { name: "额度" })).toBeTruthy();
  expect(screen.getByText("请检查")).toBeTruthy();
  expect(grid?.nextElementSibling).toBe(screen.getByText("最近动态"));
  expect(root.children[0].getAttribute("data-slot")).toBe("page-header");
  expect(container.querySelector("main")).toBeNull();
});

it("没有 stats 时不创建统计网格，保留主体", () => {
  const { container } = renderKit(
    <DashboardPage title="总览">
      <Card>最近动态</Card>
    </DashboardPage>,
  );
  expect(
    container.querySelector('[data-slot="dashboard-page-stats"]'),
  ).toBeNull();
  expect(container.querySelector('[data-slot="stat-card"]')).toBeNull();
  expect(container.firstElementChild?.children).toHaveLength(2);
  expect(screen.getByText("最近动态")).toBeTruthy();
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
