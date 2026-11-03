import { act, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  firstId,
  ipcError,
  objectProps,
  renderDevtools,
  setupJobs,
} from "./devtools.test-support";
import { resolveJob, WorkbenchJobObject } from "./workbench-object";

test("任务解析为与布局无关的工作台对象，关闭只取消观察", async () => {
  const { calls, streams } = setupJobs();
  const props = objectProps();
  const object = await resolveJob(props.object.ref);
  expect(object?.title).toBe(`测试任务 · ${firstId}`);
  expect(object?.iconId).toBe("jobs");
  if (!object) throw new Error("Expected existing object");
  const view = renderDevtools(
    <WorkbenchJobObject object={object} onUnavailable={vi.fn()} />,
  );
  await screen.findByRole("heading", { name: "测试任务" });
  view.unmount();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_stream_cancel", {
      input: { streamId: streams[0].streamId },
    }),
  );
  expect(
    calls.mock.calls
      .filter(([name]) => name.startsWith("devtools_job_"))
      .map(([name]) => name),
  ).toEqual(["devtools_job_get", "devtools_job_watch", "devtools_job_get"]);
});

test.each([
  "app.data.not_found",
  "app.permission.denied",
  "app.module.disabled",
  "account.session.locked",
])("对象不可用 %s 返回空结果", async (code) => {
  setupJobs((command) => {
    if (command === "devtools_job_get") throw ipcError(code);
  });
  expect(await resolveJob(objectProps().object.ref)).toBeNull();
});

test("对象查询的非可用性错误原样传出", async () => {
  const error = ipcError();
  setupJobs((command) => {
    if (command === "devtools_job_get") throw error;
  });
  await expect(resolveJob(objectProps().object.ref)).rejects.toEqual(error);
});

test("观察中收回读取权限时移除对象正文并通知工作台", async () => {
  const { streams } = setupJobs();
  const onUnavailable = vi.fn();
  renderDevtools(
    <WorkbenchJobObject {...objectProps()} onUnavailable={onUnavailable} />,
  );
  await screen.findByRole("heading", { name: "测试任务" });
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
