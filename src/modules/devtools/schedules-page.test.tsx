import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import { activeAuth } from "@/core/core.test-support";
import type { ScheduleSnapshot } from "@/lib/generated/ScheduleSnapshot";
import {
  firstId,
  fixtureJobKind,
  ipcError,
  renderDevtoolsPage,
  setupJobs,
} from "./devtools.test-support";

function schedule(): ScheduleSnapshot {
  return {
    id: firstId,
    key: "devtools.test_daily",
    kind: fixtureJobKind,
    cron: "0 3 * * *",
    timezone: "Asia/Shanghai",
    enabled: true,
    declared: true,
    nextRunAt: "2026-10-16T19:00:00.000Z",
    lastRunAt: "2026-10-15T19:00:00.000Z",
    lastJobId: firstId,
    lastJobStatus: "succeeded",
  };
}

test("计划表显示时区、本机时间、上次任务链接，未声明计划没有写动作", async () => {
  const { calls } = setupJobs((command) =>
    command === "devtools_schedule_list"
      ? [
          schedule(),
          {
            ...schedule(),
            id: "removed",
            key: "devtools.removed",
            declared: false,
            enabled: false,
            nextRunAt: null,
            lastRunAt: null,
            lastJobId: null,
            lastJobStatus: null,
          },
        ]
      : undefined,
  );
  renderDevtoolsPage("/devtools/schedules");
  const table = within(await screen.findByRole("table", { name: "定时计划" }));
  await table.findByText("devtools.test_daily");
  expect(table.getAllByText("Asia/Shanghai")).toHaveLength(2);
  expect(table.getByText(/本机：/)).toBeTruthy();
  expect(table.getByRole("link", { name: "已成功" }).getAttribute("href")).toBe(
    `/devtools/jobs/${firstId}`,
  );
  expect(table.getByText("未声明")).toBeTruthy();
  expect(table.getByText("开启")).toBeTruthy();
  expect(table.getByText("关闭")).toBeTruthy();
  expect(table.queryByRole("switch")).toBeNull();
  expect(table.getByRole("columnheader", { name: "操作" })).toBeTruthy();
  expect(table.getAllByRole("button", { name: "立即执行" })).toHaveLength(1);
  const removed = within(
    table.getByText("未声明").closest("tr") as HTMLTableRowElement,
  );
  expect(removed.queryByRole("button")).toBeNull();
  expect(
    calls.mock.calls.some(([name]) => name === "devtools_schedule_run_now"),
  ).toBe(false);
});

test.each([true, false])(
  "计划启用状态 %s 有写权限即可立即执行，提交后刷新且不改下次时间",
  async (enabled) => {
    const row = {
      ...schedule(),
      enabled,
      nextRunAt: enabled ? schedule().nextRunAt : null,
    };
    const { calls } = setupJobs((command) => {
      if (command === "devtools_schedule_list") return [row];
      if (command === "devtools_schedule_run_now") return { jobId: "job-new" };
    });
    const view = renderDevtoolsPage("/devtools/schedules");
    fireEvent.click(await screen.findByRole("button", { name: "立即执行" }));
    expect(
      (await screen.findByRole("link", { name: "查看任务详情" })).getAttribute(
        "href",
      ),
    ).toBe("/devtools/jobs/job-new");
    expect(screen.getByText("已提交任务。")).toBeTruthy();
    expect(calls).toHaveBeenCalledWith("devtools_schedule_run_now", {
      input: { id: firstId },
    });
    await waitFor(() =>
      expect(
        calls.mock.calls.filter(([name]) => name === "devtools_schedule_list"),
      ).toHaveLength(2),
    );
    expect(
      [...view.container.getElementsByTagName("time")].some(
        (node) => node.dateTime === schedule().nextRunAt,
      ),
    ).toBe(enabled);
  },
);

test.each(["app.data.not_found", "devtools.schedule.undeclared"])(
  "立即执行遇到 %s 后刷新列表并显示追踪号",
  async (code) => {
    let rows = [schedule()];
    const { calls } = setupJobs((command) => {
      if (command === "devtools_schedule_list") return rows;
      if (command === "devtools_schedule_run_now") {
        rows = [];
        throw ipcError(code);
      }
    });
    renderDevtoolsPage("/devtools/schedules");
    fireEvent.click(await screen.findByRole("button", { name: "立即执行" }));
    await screen.findByText("没有定时计划。");
    expect(screen.getByRole("alert").textContent).toContain("devtools-test");
    expect(screen.queryByText("已提交任务。")).toBeNull();
    expect(
      calls.mock.calls.filter(([name]) => name === "devtools_schedule_list"),
    ).toHaveLength(2);
  },
);

test("仅有读取权限时无立即执行，写权限撤回后保留计划和提交反馈", async () => {
  const { calls } = setupJobs((command) => {
    if (command === "account_auth_status")
      return { ...activeAuth, permissions: ["devtools.job.read"] };
    if (command === "devtools_schedule_list") return [schedule()];
    if (command === "devtools_schedule_run_now") return { jobId: "job-new" };
  });
  const { client } = renderDevtoolsPage("/devtools/schedules");
  await screen.findByText("devtools.test_daily");
  expect(screen.queryByRole("button", { name: "立即执行" })).toBeNull();
  await act(async () => {
    client.setQueryData(authKey, activeAuth);
  });
  fireEvent.click(await screen.findByRole("button", { name: "立即执行" }));
  await screen.findByText("已提交任务。");
  await act(async () => {
    client.setQueryData(authKey, {
      ...activeAuth,
      permissions: ["devtools.job.read"],
    });
  });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "立即执行" })).toBeNull(),
  );
  expect(screen.getByText("devtools.test_daily")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "查看任务详情" }).getAttribute("href"),
  ).toBe("/devtools/jobs/job-new");
  expect(
    calls.mock.calls.filter(([name]) => name === "devtools_schedule_run_now"),
  ).toHaveLength(1);
});

test("立即执行在途时禁用按钮，普通错误保留列表和追踪反馈", async () => {
  let rejectRun!: (error: unknown) => void;
  const { calls } = setupJobs((command) => {
    if (command === "devtools_schedule_list") return [schedule()];
    if (command === "devtools_schedule_run_now")
      return new Promise((_resolve, reject) => {
        rejectRun = reject;
      });
  });
  renderDevtoolsPage("/devtools/schedules");
  fireEvent.click(await screen.findByRole("button", { name: "立即执行" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "立即执行" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
  await act(async () => {
    rejectRun(ipcError());
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "devtools-test",
  );
  expect(screen.getByText("devtools.test_daily")).toBeTruthy();
  expect(screen.getByRole("button", { name: "立即执行" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(
    calls.mock.calls.filter(([name]) => name === "devtools_schedule_list"),
  ).toHaveLength(1);
});

test("轮询刷新下次时间和上次任务", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let row = schedule();
  const { calls } = setupJobs((command) =>
    command === "devtools_schedule_list" ? [row] : undefined,
  );
  const view = renderDevtoolsPage("/devtools/schedules");
  try {
    await screen.findByText("devtools.test_daily");
    row = {
      ...row,
      nextRunAt: "2026-10-17T19:00:00.000Z",
      lastJobId: "job-polled",
      lastJobStatus: "failed",
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "已失败" }).getAttribute("href"),
      ).toBe("/devtools/jobs/job-polled"),
    );
    expect(
      [...view.container.getElementsByTagName("time")].some(
        (node) => node.dateTime === row.nextRunAt,
      ),
    ).toBe(true);
    expect(
      calls.mock.calls.filter(([name]) => name === "devtools_schedule_list"),
    ).toHaveLength(2);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

test("计划查询失败可重试，空表显示空态", async () => {
  let failed = true;
  setupJobs((command) => {
    if (command === "devtools_schedule_list") {
      if (failed) throw ipcError();
      return [];
    }
  });
  renderDevtoolsPage("/devtools/schedules");
  expect((await screen.findByRole("alert")).textContent).toContain(
    "devtools-test",
  );
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("没有定时计划。")).toBeTruthy();
});
