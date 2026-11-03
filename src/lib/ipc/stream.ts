import { appStreamCancel } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { StreamEvent } from "@/lib/generated/StreamEvent";
import { Channel } from "./invoke";

export type StreamChannel<T> = Channel<StreamEvent<T>>;

// 同步安装 Channel 并启动订阅，任务调用方随后读取快照。
export function subscribeStream<T>(
  start: (channel: StreamChannel<T>) => Promise<unknown>,
  onEvent: (event: StreamEvent<T>) => void,
  onError: (error: IpcError) => void,
) {
  let callbacks:
    | { onEvent: typeof onEvent; onError: typeof onError }
    | undefined = { onEvent, onError };
  let streamId: string | undefined;
  let closing = false;
  let disposed = false;
  let ended = false;
  let cancellation: Promise<unknown> | undefined;
  const cancel = () => {
    closing = true;
    if (streamId && !ended) cancellation ??= appStreamCancel({ streamId });
    return cancellation ?? Promise.resolve();
  };
  const failed = (error: IpcError) => {
    if (!disposed && !ended) callbacks?.onError(error);
  };
  const channel = new Channel<StreamEvent<T>>((event) => {
    if (ended) return;
    if (event.type === "started") {
      streamId = event.streamId;
      if (closing) void cancel().catch(failed);
      if (disposed) channel.onmessage = () => {};
    }
    if (["succeeded", "failed", "cancelled", "unknown"].includes(event.type))
      ended = true;
    if (!disposed) callbacks?.onEvent(event);
    if (ended) {
      callbacks = undefined;
      channel.onmessage = () => {};
    }
  });
  // 启动 resolve 仅表示命令已接入，观察持续到终态或 dispose。
  void start(channel).catch((error: IpcError) => {
    if (ended) return;
    ended = true;
    channel.onmessage = () => {};
    if (!disposed) callbacks?.onError(error);
    callbacks = undefined;
  });
  return {
    cancel,
    dispose(waitForStarted = true) {
      if (!disposed) {
        disposed = true;
        callbacks = undefined;
        // started 可能尚未到达；保留控制回调，取得 streamId 后立即取消。
        void cancel().catch((error: IpcError) => {
          if (!ended) {
            console.error("Stream cleanup failed", {
              code: error.code,
              traceId: error.traceId,
            });
          }
        });
      }
      // AI 的本地终态期限已经到达时，不再无限保留控制回调。
      if (streamId || !waitForStarted) channel.onmessage = () => {};
    },
  };
}
