import { expect, it, vi } from "vitest";
import type { DemoDraftSaved } from "@/lib/generated/DemoDraftSaved";
import type { DemoDraftWrite } from "@/lib/generated/DemoDraftWrite";
import { createDraftWriter } from "./sample-draft-writer";

const lease = { id: "draft", sessionId: "editor", revision: 0 };
const fields = { code: "A", title: "start", note: "" };
const updatedAt = "2026-10-28T00:00:00.000Z";

it("serializes autosave and flush, coalescing newer changes with acknowledged revisions", async () => {
  const calls: DemoDraftWrite[] = [];
  let finish!: (saved: DemoDraftSaved) => void;
  const write = vi.fn((input: DemoDraftWrite) => {
    calls.push(input);
    return new Promise<DemoDraftSaved>((resolve) => {
      finish = resolve;
    });
  });
  const writer = createDraftWriter(lease, fields, write);
  writer.change({ ...fields, title: "first" });
  const flushing = writer.flush();
  writer.change({ ...fields, title: "intermediate" });
  writer.change({ ...fields, title: "last" });
  expect(writer.flush()).toBe(flushing);
  expect(calls).toHaveLength(1);
  finish({ revision: 1, updatedAt });
  await Promise.resolve();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({
    lease: { revision: 1 },
    fields: { title: "last" },
  });
  finish({ revision: 2, updatedAt });
  await flushing;
  expect(writer.lease.revision).toBe(2);
  expect(writer.pending).toBe(false);
});

it("preserves failed changes for retry and closes writers after commit/discard", async () => {
  const error = { code: "app.data.version_conflict" };
  const write = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValue({ revision: 1, updatedAt });
  const writer = createDraftWriter(lease, fields, write);
  writer.change({ ...fields, note: "recover" });
  await expect(writer.flush()).rejects.toBe(error);
  expect(writer.pending).toBe(true);
  expect(writer.lease.revision).toBe(0);
  await writer.flush();
  writer.close();
  writer.change({ ...fields, note: "late" });
  await writer.flush();
  expect(write).toHaveBeenCalledTimes(2);
});

it("keeps session leases separate and stops coalescing when a writer is closed", async () => {
  let finish!: (receipt: DemoDraftSaved) => void;
  const firstWrite = vi.fn(
    () =>
      new Promise<DemoDraftSaved>((resolve) => {
        finish = resolve;
      }),
  );
  const secondWrite = vi.fn().mockResolvedValue({ revision: 9, updatedAt });
  const first = createDraftWriter(lease, fields, firstWrite);
  const second = createDraftWriter(
    { ...lease, sessionId: "new-editor", revision: 8 },
    fields,
    secondWrite,
  );
  first.change({ ...fields, note: "first" });
  const pending = first.flush();
  first.change({ ...fields, note: "queued" });
  first.close();
  second.change({ ...fields, note: "second" });
  await second.flush();
  finish({ revision: 1, updatedAt });
  await pending;
  expect(firstWrite).toHaveBeenCalledTimes(1);
  expect(secondWrite).toHaveBeenCalledWith({
    lease: { ...lease, sessionId: "new-editor", revision: 8 },
    fields: { ...fields, note: "second" },
  });
  expect(first.lease.sessionId).toBe("editor");
  expect(second.lease).toMatchObject({ sessionId: "new-editor", revision: 9 });
  expect(lease.revision).toBe(0);
});
