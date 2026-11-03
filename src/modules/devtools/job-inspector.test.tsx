import { act, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { currentUser } from "@/core/core.test-support";
import type { JobDetail } from "@/lib/generated/JobDetail";
import {
  firstId,
  objectProps,
  renderDevtools,
  secondId,
  setupJobs,
} from "./devtools.test-support";
import { JobInspector } from "./job-inspector";
import { WorkbenchJobObject } from "./workbench-object";

test.each([
  [currentUser.id, "本机所有者"],
  [null, "系统"],
] as const)("检查器提交者 %s：%s", async (submittedBy, label) => {
  const { state } = setupJobs();
  state.detail.submittedBy = submittedBy;
  renderDevtools(<JobInspector {...objectProps()} />);
  expect(await screen.findByText(label)).toBeTruthy();
});

test("切换对象清除旧元数据与订阅，迟到快照不污染新对象", async () => {
  let resolveOld!: (detail: JobDetail) => void;
  let firstRead = true;
  const { state, calls, streams } = setupJobs((command) => {
    if (command === "devtools_job_get" && firstRead) {
      firstRead = false;
      return new Promise<JobDetail>((resolve) => {
        resolveOld = resolve;
      });
    }
  });
  let props = objectProps(firstId);
  function View() {
    return <JobInspector {...props} />;
  }
  const view = renderDevtools(<View />);
  await waitFor(() => expect(streams).toHaveLength(1));
  await act(async () => {
    streams[0].channel.onmessage({
      type: "progress",
      current: 9,
      total: 10,
      messageKey: null,
      params: {},
    });
  });
  props = objectProps(secondId);
  view.rerender(<View />);
  await screen.findByText(secondId);
  await act(async () => {
    resolveOld({ ...state.detail, id: firstId, result: "OLD_SNAPSHOT" });
  });
  expect(screen.queryByText(firstId)).toBeNull();
  expect(screen.queryByText("9 / 10")).toBeNull();
  expect(screen.queryByText("OLD_SNAPSHOT")).toBeNull();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_stream_cancel", {
      input: { streamId: streams[0].streamId },
    }),
  );
});

test("只关闭检查器时正文保持挂载，且不取消任务", async () => {
  const { calls, streams } = setupJobs();
  let inspectorOpen = true;
  const props = objectProps();
  function View() {
    return (
      <>
        <WorkbenchJobObject {...props} />
        {inspectorOpen && <JobInspector {...props} />}
      </>
    );
  }
  const view = renderDevtools(<View />);
  await waitFor(() => expect(streams).toHaveLength(2));
  await screen.findByRole("heading", { name: "任务详情" });
  inspectorOpen = false;
  view.rerender(<View />);
  expect(screen.getByRole("heading", { name: "任务详情" })).toBeTruthy();
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([name]) => name === "app_stream_cancel"),
    ).toHaveLength(1),
  );
  expect(
    calls.mock.calls.some(([name]) =>
      ["devtools_job_cancel", "devtools_job_retry"].includes(name),
    ),
  ).toBe(false);
});

test("检查器观察失败时隐藏元数据并通知调用方", async () => {
  const { streams } = setupJobs();
  const onUnavailable = vi.fn();
  renderDevtools(
    <JobInspector {...objectProps()} onUnavailable={onUnavailable} />,
  );
  await screen.findByText(firstId);
  await act(async () => {
    streams[0].channel.onmessage({
      type: "failed",
      code: "app.permission.denied",
      params: {},
    });
  });
  await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
  expect(screen.queryByText(firstId)).toBeNull();
});
