import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import { activeAuth, queryWrapper } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import { mockDemoIpc } from "../../demo.test-support";
import * as business from "../../index-page";
import pages from "../pages.json";
import { setupShowcase } from "../showcase.test-support";
import { ButtonsPage } from "./buttons-page";
import { OverviewPage } from "./overview-page";

afterEach(() => vi.restoreAllMocks());

function Pages() {
  return useLocation().pathname === "/demo/buttons" ? (
    <ButtonsPage />
  ) : (
    <OverviewPage />
  );
}

test("the isolated directory hides business cards when sample read permission is absent", async () => {
  vi.spyOn(business, "DemoIndexPage").mockReturnValue(null);
  const view = setupShowcase("/demo", <OverviewPage />);
  await waitFor(() =>
    expect(
      view.container.querySelectorAll("[data-showcase-card]"),
    ).toHaveLength(pages.length),
  );
  await act(async () => {
    view.client.setQueryData(authKey, { ...activeAuth, permissions: [] });
  });
  const directory = screen.getByRole("region", { name: "全部演示页" });
  const samples = within(directory).getByRole("region", { name: "业务样板" });
  await waitFor(() =>
    expect(samples.querySelectorAll("[data-showcase-card]")).toHaveLength(0),
  );
  expect(
    within(directory).getByRole("link", { name: "场景选型表" }),
  ).toBeTruthy();
  expect(
    within(samples)
      .getByText(i18n.t("showcase.overview.emptySection"))
      .matches(":only-child"),
  ).toBe(true);
});

test("overview loads real business totals and recent rows beneath the complete directory", async () => {
  const view = setupShowcase("/demo", <Pages />);
  const directory = screen.getByRole("region", { name: "全部演示页" });
  await waitFor(() =>
    expect(directory.querySelectorAll("[data-showcase-card]")).toHaveLength(
      pages.length,
    ),
  );
  for (const page of pages) {
    const card = directory.querySelector(
      `[data-showcase-card="${page.id}"]`,
    ) as HTMLElement;
    expect(within(card).getByRole("link").getAttribute("href")).toBe(page.path);
  }
  const business = screen.getByRole("region", { name: "业务样板概览" });
  await within(business).findByText("CARD-1");
  expect(within(business).getByText("练习卡总数：1")).toBeTruthy();
  expect(view.calls).toHaveBeenCalledWith("demo_overview_get", {});
  expect(screen.queryByRole("button", { name: "创建" })).toBeNull();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
});

test("empty business overview requests real data without creating seed records", async () => {
  const calls = mockDemoIpc();
  const { wrapper } = queryWrapper();
  render(
    <MemoryRouter>
      <business.DemoIndexPage />
    </MemoryRouter>,
    { wrapper },
  );
  await screen.findByText("尚无练习卡");
  expect(calls.mock.calls.filter(([name]) => name.startsWith("demo_"))).toEqual(
    [["demo_overview_get", {}]],
  );
  expect(screen.queryByRole("button", { name: "创建" })).toBeNull();
});

test("overview mode rejection shows the real error and trace without presenting an empty result", async () => {
  mockDemoIpc((command) =>
    command === "demo_overview_get"
      ? Promise.reject({
          code: "demo.mode.disabled",
          params: {},
          traceId: "overview-mode-trace",
        })
      : undefined,
  );
  const { wrapper } = queryWrapper();
  render(
    <MemoryRouter>
      <business.DemoIndexPage />
    </MemoryRouter>,
    { wrapper },
  );
  await screen.findByText("开发者模式已关闭，无法执行新的样板操作。");
  expect(screen.getByText(/overview-mode-trace/)).toBeTruthy();
  expect(screen.queryByText("尚无练习卡")).toBeNull();
});

test("recent pages have a live recorder and current permission filtering", async () => {
  const view = setupShowcase("/demo", <Pages />);
  await screen.findByText("CARD-1");
  await act(() => view.router.navigate("/demo/buttons"));
  await act(() => view.router.navigate("/demo"));
  const recent = screen.getByRole("region", { name: "最近查看" });
  expect(
    within(recent)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .slice(0, 2),
  ).toEqual(["/demo", "/demo/buttons"]);
  await act(async () => {
    view.client.setQueryData(authKey, {
      ...activeAuth,
      permissions: ["demo.sample.read"],
    });
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole("region", { name: "全部演示页" })).queryByRole(
        "link",
        { name: "任务与设置" },
      ),
    ).toBeNull(),
  );
  expect(within(recent).getAllByRole("link").length).toBeLessThanOrEqual(5);
});
