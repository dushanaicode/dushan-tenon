import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import { currentUser } from "@/core/core.test-support";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import * as original from "../../measure-page";
import { setupShowcase } from "../showcase.test-support";
import { MeasureGuide } from "./measure-guide";

afterEach(() => vi.restoreAllMocks());
test("measurement guide explains all five steps and gates the settings link while leaving the real wizard idle", async () => {
  const business = vi.spyOn(original, "default");
  const { container, client, calls } = setupShowcase(
    "/demo/measure",
    <MeasureGuide />,
  );
  const guide = await screen.findByRole("region", { name: "导览" });
  expect(within(guide).queryByText("已有 + 新增导览")).toBeNull();
  expect(guide.querySelectorAll("ol > li")).toHaveLength(5);
  expect(
    within(guide)
      .getByRole("link", { name: "查看样板设置" })
      .getAttribute("href"),
  ).toBe("/settings/demo");
  await screen.findByText("CARD-1");
  expect(business).toHaveBeenCalled();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("navigation", { name: "样板库" })).toBeNull();
  expect(
    container.querySelectorAll('[data-showcase-block="theme"]'),
  ).toHaveLength(0);
  expect(calls.mock.calls.some(([name]) => name === "demo_measure_start")).toBe(
    false,
  );
  await act(async () => {
    client.setQueryData<AuthStatus>(authKey, {
      state: "active",
      mode: "none",
      user: currentUser,
      permissions: ["demo.sample.read", "demo.sample.run"],
      idleLockMinutes: 15,
    });
  });
  await waitFor(() =>
    expect(
      within(guide).queryByRole("link", { name: "查看样板设置" }),
    ).toBeNull(),
  );
  expect(screen.getByRole("heading", { name: "测量向导" })).toBeTruthy();
});
