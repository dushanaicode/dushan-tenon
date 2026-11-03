import { act, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { newId } from "@/lib/id";
import { demoAppModules, jobEvent, setupDemo } from "./demo.test-support";

test("known links survive empty session list and optional modules off", async () => {
  const id = newId();
  const { state, calls, router } = setupDemo(`/demo/jobs/${id}`, (command) =>
    command === "app_modules_list"
      ? {
          modules: demoAppModules.modules.map((module) => ({
            ...module,
            enabled: ["notify", "files", "devtools"].includes(module.id)
              ? false
              : module.enabled,
          })),
        }
      : undefined,
  );
  state.job.id = id;
  await screen.findByRole("heading", { name: "本人样板任务" });
  expect(screen.getByText(/通知模块未启用/)).toBeTruthy();
  expect(
    within(
      screen.getByRole("region", { name: "本会话提交的任务" }),
    ).queryAllByRole("link"),
  ).toHaveLength(0);
  state.job.status = "needs_review";
  await jobEvent(state, { type: "unknown", reason: "jobs.needsReview" });
  await screen.findByText("执行租约已过期，结果需要人工核对。");
  await act(async () => router.navigate("/"));
  // The terminal channel needs no cancellation, while a live channel below does.
  await act(async () => router.navigate(`/demo/jobs/${id}`));
  await waitFor(() => expect(state.channels).toHaveLength(2));
  await act(async () => router.navigate("/"));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_stream_cancel", {
      input: { streamId: "job-stream-2" },
    }),
  );
});

test("a progress-only job event preserves the running snapshot", async () => {
  const id = newId();
  const { state } = setupDemo(`/demo/jobs/${id}`);
  state.job.id = id;
  await screen.findByRole("heading", { name: "本人样板任务" });
  await jobEvent(state, {
    type: "delta",
    seq: 0,
    data: {
      jobId: id,
      attempts: 1,
      rowVersion: 2,
      status: "running",
      progress: { current: 0, total: 2, messageKey: null, params: {} },
    },
  });
  const status = screen.getByText("执行中");
  await jobEvent(state, {
    type: "progress",
    current: 1,
    total: 2,
    messageKey: "demo.progress.measure",
    params: { current: "1", total: "2" },
  });
  expect(status.isConnected).toBe(true);
  expect(screen.getByText("执行中")).toBeTruthy();
});
