import { expect, test, vi } from "vitest";
import { appJobMineWatch } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobEvent } from "@/lib/generated/JobEvent";
import type { StreamEvent } from "@/lib/generated/StreamEvent";
import { type StreamChannel, subscribeStream } from "@/lib/ipc/stream";
import { mockIpc } from "./ipc.test-support";

const rejection: IpcError = {
  code: "app.internal.unexpected",
  params: {},
  traceId: "stream-test",
};

function deferred() {
  let controls:
    | { resolve: (value: unknown) => void; reject: (error: IpcError) => void }
    | undefined;
  const promise = new Promise<unknown>((resolve, reject) => {
    controls = { resolve, reject };
  });
  if (!controls) throw new Error("Promise executor must run synchronously");
  return { promise, ...controls };
}

function subscribe(start = Promise.resolve<unknown>(undefined)) {
  const channels: StreamChannel<number>[] = [];
  const onEvent = vi.fn<(event: StreamEvent<number>) => void>();
  const onError = vi.fn<(error: IpcError) => void>();
  const subscription = subscribeStream<number>(
    (channel) => {
      channels.push(channel);
      return start;
    },
    onEvent,
    onError,
  );
  const channel = channels[0];
  if (!channel) throw new Error("start must receive a channel synchronously");
  return { channel, subscription, onEvent, onError };
}

test("stream disposal handles late started", async () => {
  const calls = mockIpc((command) =>
    command === "app_stream_cancel" ? null : undefined,
  );
  const { channel, subscription, onEvent, onError } = subscribe();
  const control = channel.onmessage;
  subscription.dispose();
  subscription.dispose();
  expect(channel.onmessage).toBe(control);
  expect(calls).not.toHaveBeenCalled();
  channel.onmessage({ type: "delta", seq: 0, data: 99 });
  channel.onmessage({
    type: "progress",
    current: 1,
    total: 2,
    messageKey: null,
    params: {},
  });
  channel.onmessage({ type: "started", streamId: "early" });
  await subscription.cancel();
  expect(calls).toHaveBeenCalledExactlyOnceWith("app_stream_cancel", {
    input: { streamId: "early" },
  });
  expect(channel.onmessage).not.toBe(control);
  channel.onmessage({ type: "cancelled" });
  channel.onmessage({ type: "delta", seq: 0, data: 1 });
  expect(onEvent).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test("stream terminal ignores invoke rejection", async () => {
  const calls = mockIpc();
  const endings: StreamEvent<number>[] = [
    { type: "succeeded", data: 42 },
    { type: "failed", code: "app.input.invalid", params: {} },
    { type: "cancelled" },
    { type: "unknown", reason: "jobs.streamClosed" },
  ];
  for (const ending of endings) {
    const start = deferred();
    const { channel, subscription, onEvent, onError } = subscribe(
      start.promise,
    );
    const control = channel.onmessage;
    channel.onmessage({ type: "started", streamId: "finished" });
    channel.onmessage(ending);
    start.reject(rejection);
    await start.promise.catch(() => {});
    expect(channel.onmessage).not.toBe(control);
    channel.onmessage({ type: "delta", seq: 0, data: 99 });
    control({ type: "started", streamId: "after-terminal" });
    control({ type: "succeeded", data: 99 });
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "started", streamId: "finished" },
      ending,
    ]);
    expect(onError).not.toHaveBeenCalled();
    subscription.dispose();
  }
  expect(calls).not.toHaveBeenCalled();
});

test("stream preflight rejection reports IpcError once", async () => {
  const calls = mockIpc();
  const start = deferred();
  const { channel, subscription, onEvent, onError } = subscribe(start.promise);
  const control = channel.onmessage;
  start.reject(rejection);
  await start.promise.catch(() => {});
  expect(onError).toHaveBeenCalledExactlyOnceWith(rejection);
  expect(channel.onmessage).not.toBe(control);
  channel.onmessage({ type: "started", streamId: "late" });
  expect(onEvent).not.toHaveBeenCalled();
  subscription.dispose();
  expect(calls).not.toHaveBeenCalled();
});

test("stream start resolution preserves Job observation", async () => {
  const calls = mockIpc((command) =>
    command === "app_stream_cancel" ? null : undefined,
  );
  const start = deferred();
  const { channel, subscription, onEvent, onError } = subscribe(start.promise);
  const control = channel.onmessage;
  start.resolve(undefined);
  await start.promise;
  expect(channel.onmessage).toBe(control);
  channel.onmessage({ type: "started", streamId: "job" });
  channel.onmessage({ type: "delta", seq: 0, data: 1 });
  const progress: StreamEvent<number> = {
    type: "progress",
    current: 1,
    total: 2,
    messageKey: "jobs.progress",
    params: { count: "1" },
  };
  channel.onmessage(progress);
  expect(onEvent).toHaveBeenLastCalledWith(progress);
  const cancellation = subscription.cancel();
  expect(subscription.cancel()).toBe(cancellation);
  await cancellation;
  expect(channel.onmessage).toBe(control);
  channel.onmessage({ type: "cancelled" });
  expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
    "started",
    "delta",
    "progress",
    "cancelled",
  ]);
  expect(onError).not.toHaveBeenCalled();
  expect(calls).toHaveBeenCalledExactlyOnceWith("app_stream_cancel", {
    input: { streamId: "job" },
  });
});

test("stream disposal releases an active control callback", async () => {
  mockIpc((command) => (command === "app_stream_cancel" ? null : undefined));
  const start = deferred();
  const { channel, subscription, onEvent, onError } = subscribe(start.promise);
  const control = channel.onmessage;
  channel.onmessage({ type: "started", streamId: "active" });
  subscription.dispose();
  expect(channel.onmessage).not.toBe(control);
  start.reject(rejection);
  await start.promise.catch(() => {});
  expect(onError).not.toHaveBeenCalled();
  expect(onEvent).toHaveBeenCalledTimes(1);
});

test("stream terminal ignores a late cancel rejection", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const cancellation = deferred();
  mockIpc((command) =>
    command === "app_stream_cancel" ? cancellation.promise : undefined,
  );
  const { channel, subscription, onError } = subscribe();
  await subscription.cancel();
  channel.onmessage({ type: "started", streamId: "cancelling" });
  channel.onmessage({ type: "unknown", reason: "jobs.streamClosed" });
  subscription.dispose();
  cancellation.reject(rejection);
  await subscription.cancel().catch(() => {});
  expect(onError).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

test("stream deadline disposal releases pending control without UI callbacks", async () => {
  const calls = mockIpc();
  const start = deferred();
  const { channel, subscription, onEvent, onError } = subscribe(start.promise);
  const control = channel.onmessage;
  subscription.dispose(false);
  expect(channel.onmessage).not.toBe(control);
  channel.onmessage({ type: "started", streamId: "too-late" });
  start.reject(rejection);
  await start.promise.catch(() => {});
  expect(onEvent).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(calls).not.toHaveBeenCalled();
});

test("提前取消在 started 后只发一次，失败只通知一次", async () => {
  const cancellation = deferred();
  const calls = mockIpc(() => cancellation.promise);
  const { channel, subscription, onEvent, onError } = subscribe();
  await subscription.cancel();
  await subscription.cancel();
  expect(calls).not.toHaveBeenCalled();
  channel.onmessage({ type: "started", streamId: "late-cancel" });
  cancellation.reject(rejection);
  await subscription.cancel().catch(() => {});
  expect(calls).toHaveBeenCalledExactlyOnceWith("app_stream_cancel", {
    input: { streamId: "late-cancel" },
  });
  expect(onError).toHaveBeenCalledExactlyOnceWith(rejection);
  channel.onmessage({ type: "cancelled" });
  expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
    "started",
    "cancelled",
  ]);
});

test("主动 cancel 的拒绝交给调用方，不结束观察或重复通知", async () => {
  const cancellation = deferred();
  const calls = mockIpc(() => cancellation.promise);
  const { channel, subscription, onEvent, onError } = subscribe();
  const control = channel.onmessage;
  channel.onmessage({ type: "started", streamId: "active-cancel" });
  const result = subscription.cancel();
  cancellation.reject(rejection);
  await expect(result).rejects.toEqual(rejection);
  expect(subscription.cancel()).toBe(result);
  expect(calls).toHaveBeenCalledTimes(1);
  expect(channel.onmessage).toBe(control);
  expect(onError).not.toHaveBeenCalled();
  channel.onmessage({ type: "succeeded", data: 1 });
  expect(onEvent).toHaveBeenLastCalledWith({ type: "succeeded", data: 1 });
});

test("dispose 等待期间先收到终态则立即释放，不再等待 started", async () => {
  const calls = mockIpc();
  const { channel, subscription, onEvent, onError } = subscribe();
  const control = channel.onmessage;
  subscription.dispose();
  channel.onmessage({ type: "failed", code: "app.stream.closed", params: {} });
  expect(channel.onmessage).not.toBe(control);
  control({ type: "started", streamId: "after-terminal" });
  await subscription.cancel();
  expect(calls).not.toHaveBeenCalled();
  expect(onEvent).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test("dispose(false) 可释放此前 dispose 保留的迟到启动等待", async () => {
  const calls = mockIpc();
  const { channel, subscription, onEvent, onError } = subscribe();
  const control = channel.onmessage;
  subscription.dispose();
  expect(channel.onmessage).toBe(control);
  subscription.dispose(false);
  expect(channel.onmessage).not.toBe(control);
  subscription.dispose();
  channel.onmessage({ type: "started", streamId: "after-deadline" });
  await subscription.cancel();
  expect(calls).not.toHaveBeenCalled();
  expect(onEvent).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test("重复 dispose 的取消失败只记录一次安全元数据", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const cancellation = deferred();
  const calls = mockIpc(() => cancellation.promise);
  const { channel, subscription, onEvent, onError } = subscribe();
  const control = channel.onmessage;
  channel.onmessage({ type: "started", streamId: "cleanup" });
  subscription.dispose();
  subscription.dispose();
  expect(channel.onmessage).not.toBe(control);
  const error = {
    ...rejection,
    params: { detail: "private detail" },
    source: new Error("private source"),
  };
  cancellation.reject(error);
  await subscription.cancel().catch(() => {});
  channel.onmessage({ type: "delta", seq: 0, data: 99 });
  expect(calls).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledExactlyOnceWith("Stream cleanup failed", {
    code: rejection.code,
    traceId: rejection.traceId,
  });
  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

test("dispose 后迟到启动的取消失败不回调界面且不重试", async () => {
  const cancellation = deferred();
  const calls = mockIpc(() => cancellation.promise);
  const { channel, subscription, onEvent, onError } = subscribe();
  const control = channel.onmessage;
  subscription.dispose();
  channel.onmessage({ type: "started", streamId: "late-cleanup" });
  expect(channel.onmessage).not.toBe(control);
  cancellation.reject(rejection);
  await subscription.cancel().catch(() => {});
  subscription.dispose();
  expect(calls).toHaveBeenCalledTimes(1);
  expect(onEvent).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test("生成的任务订阅同步接入已安装的 Channel，返回后可读取快照", async () => {
  const input = { id: "019a41a8-9000-7000-8000-000000000001" };
  const started: StreamEvent<JobEvent> = {
    type: "started",
    streamId: "019a41a8-9000-7000-8000-000000000002",
  };
  const onEvent = vi.fn<(event: StreamEvent<JobEvent>) => void>();
  const onError = vi.fn<(error: IpcError) => void>();
  const calls = mockIpc((command, args) => {
    if (command === "app_job_mine_watch") {
      const { channel } = args as { channel: StreamChannel<JobEvent> };
      channel.onmessage(started);
    }
    return null;
  });
  const subscription = subscribeStream<JobEvent>(
    (channel) => appJobMineWatch(input, channel),
    onEvent,
    onError,
  );
  // 返回订阅时，启动调用与同步到达的事件都已处理。
  expect(calls).toHaveBeenCalledExactlyOnceWith("app_job_mine_watch", {
    input,
    channel: expect.anything(),
  });
  expect(onEvent).toHaveBeenCalledExactlyOnceWith(started);
  expect(onError).not.toHaveBeenCalled();
  subscription.dispose();
  await subscription.cancel();
});
