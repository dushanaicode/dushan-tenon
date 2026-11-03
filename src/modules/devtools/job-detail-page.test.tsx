import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { Route, Routes } from "react-router";
import { expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import { activeAuth } from "@/core/core.test-support";
import { ExchangeJob, useExchangeJob } from "@/core/exchange/job";
import type { JobDetail } from "@/lib/generated/JobDetail";
import type { JobStatus } from "@/lib/generated/JobStatus";
import { malformedIds } from "@/lib/id.test-support";
import {
  firstId,
  fixtureProgressKey,
  ipcError,
  renderDevtools,
  renderDevtoolsPage,
  setupJobs,
} from "./devtools.test-support";
import { JobDetailPage } from "./job-detail-page";

test.each(malformedIds().filter(([label]) => label !== "empty"))(
  "无效任务路由 %s 不调用任何 IPC",
  async (_label, id) => {
    const { calls } = setupJobs();
    renderDevtools(
      <Routes>
        <Route path="/devtools/jobs/:id" element={<JobDetailPage />} />
      </Routes>,
      `/devtools/jobs/${id}`,
    );
    await screen.findByText("页面不存在");
    expect(calls).not.toHaveBeenCalled();
  },
);

test("有效 UUIDv7 即使记录不存在仍进入 get/watch", async () => {
  const { calls } = setupJobs((command) => {
    if (command === "devtools_job_get" || command === "devtools_job_watch")
      throw ipcError("app.data.not_found");
  });
  renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  await screen.findByRole("heading", { name: "任务详情" });
  await waitFor(() => {
    expect(calls).toHaveBeenCalledWith("devtools_job_get", {
      input: { id: firstId },
    });
    expect(calls).toHaveBeenCalledWith(
      "devtools_job_watch",
      expect.objectContaining({ input: { id: firstId } }),
    );
  });
  expect(screen.queryByRole("heading", { name: "页面不存在" })).toBeNull();
});

test("先观察后读快照，Channel 更新进度与终态结果，卸载仅释放观察", async () => {
  const { state, streams, calls } = setupJobs();
  const view = renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  await screen.findByRole("heading", { name: "测试任务" });
  const names = calls.mock.calls.map(([name]) => name);
  expect(names.indexOf("devtools_job_watch")).toBeLessThan(
    names.indexOf("devtools_job_get"),
  );
  await act(async () => {
    streams[0].channel.onmessage({
      type: "progress",
      current: 500,
      total: 1000,
      messageKey: fixtureProgressKey,
      params: { current: "1", total: "2" },
    });
  });
  expect(screen.getByText("500 / 1000")).toBeTruthy();
  expect(screen.getByText("已处理 1 / 2 项")).toBeTruthy();
  await act(async () => {
    streams[0].channel.onmessage({
      type: "delta",
      seq: 1,
      data: {
        jobId: firstId,
        status: "succeeded",
        progress: { current: 1000, total: 1000, messageKey: null, params: {} },
        attempts: 1,
        rowVersion: 2,
      },
    });
  });
  expect(screen.getByText("1000 / 1000")).toBeTruthy();
  expect(screen.queryByText("已处理 1 / 2 项")).toBeNull();
  expect(screen.queryByRole("button", { name: "取消任务" })).toBeNull();
  view.unmount();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_stream_cancel", {
      input: { streamId: streams[0].streamId },
    }),
  );
  state.detail = {
    ...state.detail,
    status: "succeeded",
    result: { processed: 500 },
  };
  renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  await screen.findByRole("heading", { name: "测试任务" });
  await act(async () => {
    streams[1].channel.onmessage({ type: "succeeded", data: null });
  });
  expect(await screen.findByText(/"processed": 500/)).toBeTruthy();
  expect(
    calls.mock.calls.some(([name]) =>
      [
        "devtools_job_cancel",
        "devtools_job_retry",
        "devtools_job_resolve",
      ].includes(name),
    ),
  ).toBe(false);
});

test.each([
  "queued",
  "running",
  "failed",
  "cancelled",
  "needs_review",
  "succeeded",
] satisfies JobStatus[])("%s 详情的状态动作与写权限撤回", async (status) => {
  const { state, calls } = setupJobs();
  state.detail.status = status;
  const { client } = renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  await screen.findByRole("heading", { name: "测试任务" });
  for (const [name, visible] of [
    ["取消任务", status === "queued" || status === "running"],
    ["重试任务", ["failed", "cancelled", "needs_review"].includes(status)],
    ["核对为成功", status === "needs_review"],
    ["核对为失败", status === "needs_review"],
  ] as const)
    expect(Boolean(screen.queryByRole("button", { name }))).toBe(visible);
  await act(async () => {
    client.setQueryData(authKey, {
      ...activeAuth,
      permissions: ["devtools.job.read"],
    });
  });
  expect(screen.getByRole("heading", { name: "测试任务" })).toBeTruthy();
  await waitFor(() => {
    for (const name of ["取消任务", "重试任务", "核对为成功", "核对为失败"])
      expect(screen.queryByRole("button", { name })).toBeNull();
  });
  expect(
    calls.mock.calls.some(([name]) =>
      [
        "devtools_job_cancel",
        "devtools_job_retry",
        "devtools_job_resolve",
      ].includes(name),
    ),
  ).toBe(false);
});

test.each(["cancel", "retry", "succeeded", "failed"] as const)(
  "任务操作 %s 使用生成命令，成功后刷新事实并重新观察",
  async (action) => {
    const command =
      action === "cancel"
        ? "devtools_job_cancel"
        : action === "retry"
          ? "devtools_job_retry"
          : "devtools_job_resolve";
    const names = {
      cancel: "取消任务",
      retry: "重试任务",
      succeeded: "核对为成功",
      failed: "核对为失败",
    };
    const { state, streams, calls } = setupJobs((name) => {
      if (name === command) {
        state.detail = {
          ...state.detail,
          status:
            action === "retry"
              ? "queued"
              : action === "cancel"
                ? "running"
                : action,
          cancelRequested: action === "cancel",
        };
        return null;
      }
    });
    state.detail.status =
      action === "cancel"
        ? "running"
        : action === "retry"
          ? "failed"
          : "needs_review";
    renderDevtoolsPage(`/devtools/jobs/${firstId}`);
    fireEvent.click(await screen.findByRole("button", { name: names[action] }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith(command, {
        input: {
          id: firstId,
          ...(action === "succeeded" || action === "failed"
            ? { outcome: action }
            : {}),
        },
      }),
    );
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(calls).toHaveBeenCalledWith("app_stream_cancel", {
      input: { streamId: streams[0].streamId },
    });
    if (action === "cancel")
      expect(
        await screen.findByRole("button", { name: "正在取消" }),
      ).toHaveProperty("disabled", true);
    else
      await screen.findByText(
        action === "retry"
          ? "排队中"
          : action === "succeeded"
            ? "已成功"
            : "已失败",
      );
  },
);

test.each([
  "devtools_job_cancel",
  "devtools_job_retry",
  "devtools_job_resolve",
])("%s 失败显示追踪号并刷新事实", async (command) => {
  const { state, calls } = setupJobs((name) => {
    if (name === command) {
      state.detail.status = "succeeded";
      throw ipcError();
    }
  });
  state.detail.status = command.endsWith("cancel") ? "running" : "needs_review";
  renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  fireEvent.click(
    await screen.findByRole("button", {
      name: command.endsWith("cancel")
        ? "取消任务"
        : command.endsWith("retry")
          ? "重试任务"
          : "核对为失败",
    }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "devtools-test",
  );
  await screen.findByText("已成功");
  expect(
    calls.mock.calls.filter(([name]) => name === "devtools_job_get"),
  ).toHaveLength(2);
});

test("已请求取消时禁止重复提交，写操作在途时禁用动作", async () => {
  let finish!: () => void;
  const { state } = setupJobs((command) => {
    if (command === "devtools_job_retry")
      return new Promise<null>((resolve) => {
        finish = () => resolve(null);
      });
  });
  state.detail.cancelRequested = true;
  const view = renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  expect(
    await screen.findByRole("button", { name: "正在取消" }),
  ).toHaveProperty("disabled", true);
  view.unmount();
  state.detail.cancelRequested = false;
  state.detail.status = "needs_review";
  renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  fireEvent.click(await screen.findByRole("button", { name: "重试任务" }));
  await waitFor(() => {
    for (const name of ["重试任务", "核对为成功", "核对为失败"])
      expect(screen.getByRole("button", { name })).toHaveProperty(
        "disabled",
        true,
      );
  });
  await act(async () => finish());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "重试任务" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
});

test("核对后重试清除旧流提示并接收新观察的进度", async () => {
  const { state, streams } = setupJobs((command) => {
    if (command === "devtools_job_retry") {
      state.detail.status = "queued";
      return null;
    }
  });
  renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  await screen.findByRole("heading", { name: "测试任务" });
  state.detail.status = "needs_review";
  await act(async () => {
    streams[0].channel.onmessage({
      type: "unknown",
      reason: "jobs.needsReview",
    });
  });
  await screen.findByText("需核对");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "重试任务" }));
  await waitFor(() => expect(streams).toHaveLength(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await act(async () => {
    streams[1].channel.onmessage({
      type: "progress",
      current: 1,
      total: 3,
      messageKey: null,
      params: {},
    });
  });
  expect(screen.getByRole("progressbar")).toHaveProperty("value", 1);
  expect(screen.getByRole("progressbar")).toHaveProperty("max", 3);
});

test.each(["failed", "cancelled", "unknown"] as const)(
  "流终态 %s 补读事实并保留提示",
  async (type) => {
    const { state, streams } = setupJobs();
    renderDevtoolsPage(`/devtools/jobs/${firstId}`);
    await screen.findByRole("heading", { name: "测试任务" });
    state.detail.status = type === "unknown" ? "needs_review" : type;
    state.detail.errorCode =
      type === "failed" ? "app.internal.unexpected" : null;
    await act(async () => {
      const event =
        type === "failed"
          ? { type, code: "app.internal.unexpected", params: {} }
          : type === "unknown"
            ? { type, reason: "jobs.needsReview" }
            : { type };
      streams[0].channel.onmessage(event);
    });
    await screen.findByText(
      type === "failed" ? "已失败" : type === "cancelled" ? "已取消" : "需核对",
    );
    if (type !== "cancelled")
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  },
);

test("首个快照未返回就收到终态时，仍重新读取最终结果", async () => {
  let resolveInitial!: (detail: JobDetail) => void;
  let reads = 0;
  const { state, streams } = setupJobs((command) => {
    if (command === "devtools_job_get" && ++reads === 1)
      return new Promise<JobDetail>((resolve) => {
        resolveInitial = resolve;
      });
  });
  renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  await waitFor(() => expect(streams).toHaveLength(1));
  state.detail = {
    ...state.detail,
    status: "succeeded",
    result: { finalResult: 1 },
  };
  await act(async () => {
    streams[0].channel.onmessage({ type: "succeeded", data: null });
  });
  expect(await screen.findByText(/"finalResult": 1/)).toBeTruthy();
  await act(async () => {
    resolveInitial({ ...state.detail, status: "running", result: null });
  });
  expect(screen.getByText(/"finalResult": 1/)).toBeTruthy();
});

test("开发者模式关闭且 devtools 停用时，本人任务仍可查看进度和取消", async () => {
  const { calls } = setupJobs((command, payload) => {
    if (command === "app_settings_get")
      return Promise.reject(new Error("本人任务不得读取开发者模式"));
    if (command === "app_modules_list")
      return Promise.reject(new Error("本人任务不得读取模块开关"));
    if (command === "app_job_mine_watch") {
      const { channel } = payload as {
        channel: { onmessage: (event: unknown) => void };
      };
      channel.onmessage({ type: "started", streamId: firstId });
      channel.onmessage({
        type: "progress",
        current: 2,
        total: 10,
        messageKey: null,
        params: {},
      });
      return null;
    }
    if (command === "app_job_mine_cancel") return null;
  });
  const complete = vi.fn();
  const { result } = renderHook(() => useExchangeJob(firstId, complete));
  await waitFor(() => expect(result.current.progress.current).toBe(2));
  renderDevtools(<ExchangeJob job={result.current} />);
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("2");
  await act(async () => {
    await result.current.cancel();
  });
  expect(calls).toHaveBeenCalledWith("app_job_mine_cancel", {
    input: { id: firstId },
  });
  expect(
    calls.mock.calls.some(
      ([name]) =>
        name.startsWith("devtools_") ||
        name === "app_settings_get" ||
        name === "app_modules_list",
    ),
  ).toBe(false);
});
