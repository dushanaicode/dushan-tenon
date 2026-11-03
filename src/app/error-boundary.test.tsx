import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { i18n } from "@/core/i18n";
import type { WindowEvent } from "@/lib/generated/WindowEvent";
import type { Channel } from "@/lib/ipc/invoke";
import { mockAppIpc, renderApp } from "./app.test-support";

const crash = vi.hoisted(() => ({ active: false }));
vi.mock("./routes", async (original) => {
  const actual = await original<typeof import("./routes")>();
  return {
    AppRoutes: (props: Parameters<typeof actual.AppRoutes>[0]) => {
      useLocation();
      if (crash.active) throw new Error("private-render-sentinel");
      return <actual.AppRoutes {...props} />;
    },
  };
});

test("路由崩溃后错误页接管关闭，旧通道失效且不清掉未保存状态", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const channels: Channel<WindowEvent>[] = [];
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_window_watch") {
      channels.push((payload as { onEvent: Channel<WindowEvent> }).onEvent);
      return null;
    }
  });
  const { router, container } = renderApp("/settings/param.account.security", {
    titlebar: { value: "hidden", source: "file" },
  });
  fireEvent.change(
    await screen.findByRole("textbox", { name: "空闲自动锁定（分钟）" }),
    { target: { value: "25" } },
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: true, pending: false },
    }),
  );
  calls.mockClear();
  crash.active = true;
  try {
    await act(async () => {
      await router.navigate("/settings/appearance");
    });
    await screen.findByRole("heading", { name: i18n.t("recovery.title") });
    expect(document.body.textContent).not.toContain("private-render-sentinel");
    expect(channels).toHaveLength(2);
    expect(
      calls.mock.calls.some(([command]) => command === "app_window_edit_state"),
    ).toBe(false);
    calls.mockClear();
    act(() =>
      channels[0].onmessage({ type: "close_edit", requestId: "stale" }),
    );
    expect(calls).not.toHaveBeenCalled();
    act(() =>
      channels[1].onmessage({ type: "close_edit", requestId: "after-error" }),
    );
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("app_window_edit_decide", {
        input: { requestId: "after-error", proceed: true },
      }),
    );
    expect(
      calls.mock.calls.some(([command]) => command === "app_window_edit_state"),
    ).toBe(false);
    expect(
      container.querySelectorAll(
        `section[aria-label="${i18n.t("kit.toast.region")}"]`,
      ),
    ).toHaveLength(1);
  } finally {
    crash.active = false;
  }
});
