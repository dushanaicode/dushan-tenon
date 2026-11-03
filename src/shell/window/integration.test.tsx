import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it } from "vitest";
import type { WindowEvent } from "@/lib/generated/WindowEvent";
import type { Channel } from "@/lib/ipc/invoke";
import { mockShellIpc, renderShell } from "../shell.test-support";

it.each(["native", "hidden"] as const)(
  "Console %s 标题栏接收真实 Channel 状态，Zen 保留退出入口",
  async (titlebar) => {
    let channel!: Channel<WindowEvent>;
    mockShellIpc((name, payload) => {
      if (name === "app_window_watch") {
        channel = (payload as { onEvent: Channel<WindowEvent> }).onEvent;
        return null;
      }
    });
    renderShell({}, "/", undefined, titlebar);
    await screen.findByRole("button", { name: "搜索命令" });
    if (titlebar === "hidden") {
      const group = screen.getByRole("group", { name: "窗口控制" });
      act(() =>
        channel.onmessage({ type: "state", maximized: true, focused: false }),
      );
      expect(group.dataset.windowMaximized).toBe("true");
      expect(within(group).getByRole("button", { name: "还原" })).toBeTruthy();
    } else expect(screen.queryByRole("group", { name: "窗口控制" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "搜索命令" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "进入专注模式" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "退出专注模式" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "搜索命令" })).toBeTruthy(),
    );
  },
);
