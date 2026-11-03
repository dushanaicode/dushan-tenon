import { act, waitFor } from "@testing-library/react";
import { assert } from "vitest";
import type { FilePicked } from "@/lib/generated/FilePicked";
import type { FilePickInput } from "@/lib/generated/FilePickInput";
import type { JobEvent } from "@/lib/generated/JobEvent";
import type { JobSnapshot } from "@/lib/generated/JobSnapshot";
import type { StreamEvent } from "@/lib/generated/StreamEvent";
import type { StreamChannel } from "@/lib/ipc/stream";
import { currentUser, mockAppIpc } from "../core.test-support";

export function setupExchange(override?: Parameters<typeof mockAppIpc>[0]) {
  const time = "2026-11-02T00:00:00.000Z";
  const state: {
    selection: FilePicked | null;
    channel?: StreamChannel<JobEvent>;
    detail: JobSnapshot;
  } = {
    selection: { token: "file-token", fileName: "rows.csv", format: "csv" },
    detail: {
      id: "job",
      kind: "fixture.import",
      module: "fixture",
      payload: {},
      priority: 0,
      status: "queued",
      attempts: 1,
      maxAttempts: 1,
      retrySafe: false,
      runAfter: time,
      progress: { current: null, total: null, messageKey: null, params: {} },
      result: null,
      errorCode: null,
      errorParams: {},
      cancelRequested: false,
      submittedBy: currentUser.id,
      createdAt: time,
      updatedAt: time,
      startedAt: time,
      finishedAt: null,
      rowVersion: 1,
    },
  };
  const calls = mockAppIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    if (command === "app_file_pick") {
      const { input } = payload as { input: FilePickInput };
      return (
        state.selection && {
          ...state.selection,
          format: input.format ?? state.selection.format,
        }
      );
    }
    if (command === "app_job_mine_cancel" || command === "app_stream_cancel")
      return null;
    if (command === "app_job_mine_get") return structuredClone(state.detail);
    if (command === "app_job_mine_watch") {
      state.channel = (payload as { channel: StreamChannel<JobEvent> }).channel;
      state.channel.onmessage({
        type: "started",
        streamId: `stream-${state.detail.id}`,
      });
      return null;
    }
  });
  return { state, calls };
}

export async function send(
  state: ReturnType<typeof setupExchange>["state"],
  event: StreamEvent<JobEvent>,
) {
  await waitFor(() => assert(state.channel));
  const channel = state.channel;
  assert(channel);
  await act(async () => {
    channel.onmessage(event);
  });
}
