import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, vi } from "vitest";

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

export function mockIpc(handler: Parameters<typeof mockIPC>[0] = () => null) {
  const calls = vi.fn(handler);
  mockIPC(calls);
  return calls;
}
