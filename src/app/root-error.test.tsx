import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { WindowEvent } from "@/lib/generated/WindowEvent";
import type { Channel } from "@/lib/ipc/invoke";
import { mockAppIpc } from "./app.test-support";
import { RootError } from "./root-error";

test("复制失败时只显示安全摘要，不回显原始错误", async () => {
  mockAppIpc();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("private/path secret-sentinel"),
  );
  render(<RootError titlebar="native" platform="windows" />);
  fireEvent.click(screen.getByRole("button", { name: "复制故障摘要" }));
  const report = await screen.findByRole("textbox", { name: "复制故障摘要" });
  expect((report as HTMLTextAreaElement).value).toMatch(
    /^Tenon UI recovery v1\ncode=app.ui.failed\ntraceId=/,
  );
  expect(document.body.textContent).not.toContain("secret-sentinel");
  expect((report as HTMLTextAreaElement).value).not.toContain("private/path");
});

test("错误页用 content ScrollArea，提供显式重载", () => {
  mockAppIpc();
  const reload = vi
    .spyOn(window.location, "reload")
    .mockImplementation(() => {});
  render(<RootError titlebar="native" platform="windows" />);
  expect(
    screen
      .getByRole("main")
      .closest('[data-kit="scroll-area"]')
      ?.getAttribute("data-region"),
  ).toBe("content");
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test("错误页接管唯一窗口订阅和关闭，不发布虚假 clean", async () => {
  const channels: Channel<WindowEvent>[] = [];
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_window_watch") {
      channels.push((payload as { onEvent: Channel<WindowEvent> }).onEvent);
      return null;
    }
  });
  render(<RootError titlebar="hidden" platform="windows" />);
  await waitFor(() => expect(channels).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_close", {}),
  );
  act(() =>
    channels[0].onmessage({ type: "close_edit", requestId: "error-close" }),
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId: "error-close", proceed: true },
    }),
  );
  expect(
    calls.mock.calls.some(([command]) => command === "app_window_edit_state"),
  ).toBe(false);
});
