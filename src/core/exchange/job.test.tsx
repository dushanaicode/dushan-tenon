import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { JobSnapshot } from "@/lib/generated/JobSnapshot";
import { send, setupExchange } from "./exchange.test-support";
import { useExchangeJob } from "./job";

test("progress is observed until cancellation reaches its terminal snapshot", async () => {
  const { state, calls } = setupExchange();
  const complete = vi.fn();
  const { result } = renderHook(() => useExchangeJob("job", complete));
  await send(state, {
    type: "progress",
    current: 2,
    total: 10,
    messageKey: "exchange.progress.validating",
    params: { current: "2", total: "10" },
  });
  expect(result.current.progress.current).toBe(2);
  expect(result.current.status).toBe("running");
  await act(async () => {
    await result.current.cancel();
  });
  expect(calls).toHaveBeenCalledWith("app_job_mine_cancel", {
    input: { id: "job" },
  });
  expect(result.current.active).toBe(true);
  expect(result.current.cancelling).toBe(true);
  state.detail.status = "cancelled";
  await send(state, { type: "cancelled" });
  await waitFor(() => expect(result.current.status).toBe("cancelled"));
  expect(calls).toHaveBeenCalledWith("app_job_mine_get", {
    input: { id: "job" },
  });
  expect(result.current.active).toBe(false);
  expect(result.current.cancelling).toBe(false);
  expect(complete).toHaveBeenCalledTimes(1);
});

test("completion uses the current callback and late duplicate terminals are ignored", async () => {
  const { state } = setupExchange();
  const first = vi.fn(),
    latest = vi.fn();
  const { rerender } = renderHook(
    ({ complete }) => useExchangeJob("job", complete),
    { initialProps: { complete: first } },
  );
  rerender({ complete: latest });
  state.detail.status = "succeeded";
  await send(state, { type: "succeeded", data: null });
  await send(state, { type: "succeeded", data: null });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
});

test("changing jobs ignores an old snapshot and disposes live streams", async () => {
  let resolveOld!: (value: JobSnapshot) => void;
  const { state, calls } = setupExchange((command) =>
    command === "app_job_mine_get"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : undefined,
  );
  const complete = vi.fn();
  const { result, rerender, unmount } = renderHook(
    ({ id }) => useExchangeJob(id, complete),
    { initialProps: { id: "job" } },
  );
  await send(state, { type: "succeeded", data: null });
  await waitFor(() => expect(resolveOld).toBeDefined());
  rerender({ id: "next" });
  await act(async () => {
    resolveOld({ ...state.detail, status: "succeeded" });
  });
  expect(result.current.detail).toBeUndefined();
  expect(complete).not.toHaveBeenCalled();
  unmount();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_stream_cancel", {
      input: { streamId: "stream-job" },
    }),
  );
  expect(
    calls.mock.calls.filter(([command]) => command === "app_job_mine_cancel"),
  ).toHaveLength(0);
});

test("watch failures are displayed and stop observation", async () => {
  setupExchange((command) => {
    if (command === "app_job_mine_watch")
      throw { code: "app.auth.locked", params: {}, traceId: "watch-denied" };
  });
  const { result } = renderHook(() => useExchangeJob("job", () => {}));
  await waitFor(() =>
    expect(result.current.error?.traceId).toBe("watch-denied"),
  );
  expect(result.current.active).toBe(false);
});

test("failed cancel requests preserve the live job and permit retry", async () => {
  setupExchange((command) => {
    if (command === "app_job_mine_cancel")
      throw { code: "app.operation.busy", params: {}, traceId: "cancel-busy" };
  });
  const { result } = renderHook(() => useExchangeJob("job", () => {}));
  await act(async () => {
    await result.current.cancel();
  });
  expect(result.current.error?.traceId).toBe("cancel-busy");
  expect(result.current.active).toBe(true);
  expect(result.current.cancelling).toBe(false);
});

test("late cancellation failures do not contaminate the next job", async () => {
  let rejectCancel!: (error: unknown) => void;
  setupExchange((command) =>
    command === "app_job_mine_cancel"
      ? new Promise((_resolve, reject) => {
          rejectCancel = reject;
        })
      : undefined,
  );
  const { result, rerender } = renderHook(
    ({ id }) => useExchangeJob(id, () => {}),
    { initialProps: { id: "job" } },
  );
  let cancellation!: Promise<void>;
  act(() => {
    cancellation = result.current.cancel();
  });
  rerender({ id: "next" });
  await act(async () => {
    rejectCancel({
      code: "app.operation.busy",
      params: {},
      traceId: "old-cancel",
    });
    await cancellation;
  });
  expect(result.current.error).toBeUndefined();
  expect(result.current.active).toBe(true);
  expect(result.current.cancelling).toBe(false);
});
