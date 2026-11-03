import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import type { FileIngressSnapshot } from "@/lib/generated/FileIngressSnapshot";
import type { WindowEvent } from "@/lib/generated/WindowEvent";
import type { Channel } from "@/lib/ipc/invoke";
import { mockAppIpc, renderApp } from "./app.test-support";

test("窗口文件事件刷新真实接入队列，经目录门控后才打开页面", async () => {
  let snapshot: FileIngressSnapshot = {
    pending: [],
    recent: [],
    issue: null,
    skippedDirectories: 0,
  };
  const channels: Channel<WindowEvent>[] = [];
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_window_watch") {
      channels.push((payload as { onEvent: Channel<WindowEvent> }).onEvent);
      return null;
    }
    if (command === "app_file_ingress_list") return snapshot;
    if (command === "app_file_ingress_dismiss") {
      snapshot = { ...snapshot, pending: [] };
      return null;
    }
  });
  const { router } = renderApp();
  await screen.findByRole("heading", { name: "渡山榫卯" });
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_file_ingress_list", {}),
  );
  snapshot = {
    ...snapshot,
    pending: [
      { type: "route", id: "allowed", path: "/notify" },
      { type: "route", id: "denied", path: "/files" },
    ],
  };
  act(() => channels[0].onmessage({ type: "files_changed" }));
  const dialog = await screen.findByRole("dialog", { name: "打开文件" });
  const buttons = within(dialog).getAllByRole("button", { name: "打开页面" });
  expect(buttons[0]).toHaveProperty("disabled", false);
  expect(buttons[1]).toHaveProperty("disabled", true);
  expect(
    calls.mock.calls.some(([command]) => command.startsWith("files_")),
  ).toBe(false);
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/notify"));
  expect(calls).toHaveBeenCalledWith("app_file_ingress_dismiss", {
    input: { ids: ["allowed"], clearRecent: false },
  });
  expect(await screen.findByRole("heading", { name: "通知中心" })).toBeTruthy();
});
