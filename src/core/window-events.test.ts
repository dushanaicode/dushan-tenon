import { expect, it, vi } from "vitest";
import { emitWindowEvent, onWindowEvent } from "./window-events";

it("preserves synchronous cancellable close ownership and typed request IDs", () => {
  const receive = vi.fn((event: WindowEventMap["tenon:edit-close"]) =>
    event.preventDefault(),
  );
  const stop = onWindowEvent("tenon:edit-close", receive);
  const request = { type: "close_edit", requestId: "close-request" } as const;
  expect(emitWindowEvent("tenon:edit-close", request)).toBe(true);
  expect(receive.mock.calls[0][0].detail).toBe(request);
  stop();
  expect(emitWindowEvent("tenon:edit-close", request)).toBe(false);
  expect(receive).toHaveBeenCalledTimes(1);
});

it("delivers generated moved and files_changed payloads without coupling them to a shell", () => {
  const moved = vi.fn();
  const files = vi.fn();
  const stopMoved = onWindowEvent("tenon:window-moved", moved);
  const stopFiles = onWindowEvent("tenon:files-changed", files);
  emitWindowEvent("tenon:window-moved", { type: "moved", x: 10, y: 20 });
  emitWindowEvent("tenon:files-changed", { type: "files_changed" });
  expect(moved.mock.calls[0][0].detail).toEqual({
    type: "moved",
    x: 10,
    y: 20,
  });
  expect(files.mock.calls[0][0].detail).toEqual({ type: "files_changed" });
  stopMoved();
  stopFiles();
});
