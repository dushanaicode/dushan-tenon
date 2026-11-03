import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import { currentUser } from "@/core/core.test-support";
import { mockAuth, renderAccount } from "./account.test-support";

afterEach(() => vi.useRealTimers());

test("活动 touch 至少间隔 30 秒，空闲到期自动锁定", async () => {
  const { status, calls } = mockAuth("anonymous");
  const { client } = renderAccount();
  await screen.findByRole("heading", { name: "登录" });
  vi.useFakeTimers();
  status.state = "active";
  status.user = { ...currentUser, mode: "login" };
  await act(async () => {
    client.setQueryData(authKey, structuredClone(status));
    await vi.advanceTimersByTimeAsync(0);
  });
  fireEvent.pointerDown(window);
  await act(() => vi.advanceTimersByTimeAsync(29_999));
  fireEvent.keyDown(window);
  expect(
    calls.mock.calls.filter(([command]) => command === "account_session_touch"),
  ).toHaveLength(0);
  await act(() => vi.advanceTimersByTimeAsync(1));
  fireEvent.wheel(window);
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.pointerDown(window);
  expect(
    calls.mock.calls.filter(([command]) => command === "account_session_touch"),
  ).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  await act(() => vi.advanceTimersByTimeAsync(10));
  expect(
    calls.mock.calls.filter(([command]) => command === "account_session_lock"),
  ).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "已锁定" })).toBeTruthy();
});
