import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { mockAppIpc } from "@/core/core.test-support";
import { toast } from "@/kit";
import type { IpcError } from "@/lib/generated/IpcError";
import type { Titlebar } from "@/lib/generated/Titlebar";
import type { WindowEvent } from "@/lib/generated/WindowEvent";
import type { Channel } from "@/lib/ipc/invoke";
import { useWindowChrome, WindowChromeProvider } from "./window-chrome";
import { ConnectedWindowControls, WindowControls } from "./window-controls";

let testPlatform: "windows" | "macos" | "linux" = "windows";

afterEach(() => vi.restoreAllMocks());

function mount({
  strict = false,
  titlebar = "hidden",
  override,
}: {
  strict?: boolean;
  titlebar?: Titlebar;
  override?: Parameters<typeof mockAppIpc>[0];
} = {}) {
  const channels: Channel<WindowEvent>[] = [];
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_window_watch") {
      channels.push((payload as { onEvent: Channel<WindowEvent> }).onEvent);
      return null;
    }
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    if (command.startsWith("app_window_")) return null;
  });
  const content = (
    <WindowChromeProvider platform={testPlatform} titlebar={titlebar}>
      <button type="button">原有焦点</button>
      <ConnectedWindowControls />
    </WindowChromeProvider>
  );
  const view = render(strict ? <StrictMode>{content}</StrictMode> : content);
  function emit(event: WindowEvent) {
    act(() => channels[channels.length - 1].onmessage(event));
  }
  return { ...view, calls, channels, emit };
}

const failure = (code: string): IpcError => ({
  code,
  params: { key: "window.close_action" },
  traceId: "window-test",
});
const decisions = (calls: ReturnType<typeof mockAppIpc>) =>
  calls.mock.calls.filter(([name]) => name === "app_window_close_decide");

test("window controls require the provider", () => {
  expect(() => renderHook(useWindowChrome)).toThrow(
    "useWindowChrome requires WindowChromeProvider",
  );
});

test("pages without an editor provider acknowledge a close without publishing a clean edit state", async () => {
  const { emit, calls } = mount();
  const requestId = "1240521e-7199-4966-9c82-78fd006058f4";
  emit({ type: "close_edit", requestId });
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: true },
    }),
  );
  expect(
    calls.mock.calls.some(([name]) => name === "app_window_edit_state"),
  ).toBe(false);
});

test("an editor provider claims the cancelable close event and suppresses the automatic acknowledgement", () => {
  const receive = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener("tenon:edit-close", receive);
  try {
    const { emit, calls } = mount();
    emit({
      type: "close_edit",
      requestId: "1240521e-7199-4966-9c82-78fd006058f4",
    });
    expect(receive).toHaveBeenCalledOnce();
    expect(
      calls.mock.calls.some(([name]) => name === "app_window_edit_decide"),
    ).toBe(false);
  } finally {
    window.removeEventListener("tenon:edit-close", receive);
  }
});

test("macOS keeps native traffic lights and reserves their strip only for overlay chrome", () => {
  const previous = testPlatform;
  testPlatform = "macos";
  try {
    const view = mount();
    expect(screen.queryByRole("group", { name: "窗口控制" })).toBeNull();
    expect(document.documentElement.dataset.macTitlebar).toBe("overlay");
    view.rerender(
      <WindowChromeProvider platform={testPlatform} titlebar="native">
        <ConnectedWindowControls />
      </WindowChromeProvider>,
    );
    expect(document.documentElement.dataset.macTitlebar).toBeUndefined();
    expect(screen.queryByRole("group", { name: "窗口控制" })).toBeNull();
    view.unmount();
    expect(document.documentElement.dataset.macTitlebar).toBeUndefined();
  } finally {
    testPlatform = previous;
  }
});

test("movement sends CSS coordinates without changing window state or opening a close prompt", () => {
  const { emit } = mount();
  vi.stubGlobal("devicePixelRatio", 2);
  const moved = vi.fn();
  window.addEventListener("tenon:window-moved", moved);
  try {
    emit({ type: "moved", x: 240, y: -160 });
    expect(moved).toHaveBeenCalledTimes(1);
    expect((moved.mock.calls[0][0] as CustomEvent).detail).toEqual({
      type: "moved",
      x: 120,
      y: -80,
    });
    emit({ type: "moved", x: -32000, y: -32000 });
    expect(moved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    window.removeEventListener("tenon:window-moved", moved);
    vi.unstubAllGlobals();
  }
});

test.each([false, true])(
  "subscription and state remain single-owner (StrictMode=%s)",
  (strict) => {
    const { emit, channels, calls, unmount } = mount({ strict });
    expect(channels).toHaveLength(strict ? 2 : 1);
    const group = screen.getByRole("group", { name: "窗口控制" });
    expect(group.dataset.windowFocused).toBe("true");
    expect(group.dataset.windowMaximized).toBe("false");
    emit({ type: "state", maximized: true, focused: false });
    expect(group.dataset.windowFocused).toBe("false");
    expect(group.dataset.windowMaximized).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "还原" })
        .querySelector(".lucide-window-restore"),
    ).not.toBeNull();
    if (strict) {
      act(() =>
        channels[0].onmessage({ type: "close_ask", trayAvailable: false }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    emit({ type: "close_ask", trayAvailable: true });
    fireEvent.click(screen.getByRole("radio", { name: "退出应用" }));
    fireEvent.click(screen.getByRole("checkbox"));
    emit({ type: "close_ask", trayAvailable: false });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen
        .getByRole("radio", { name: "退出应用" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: "隐藏到托盘" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      calls.mock.calls.filter(([name]) => name === "app_window_watch"),
    ).toHaveLength(strict ? 2 : 1);
    unmount();
    emit({ type: "close_ask", trayAvailable: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

test.each(["cancel", "escape", "overlay"])(
  "dismissal by %s never decides and restores prior focus",
  async (method) => {
    const { emit, calls } = mount();
    const previous = screen.getByRole("button", { name: "原有焦点" });
    previous.focus();
    emit({ type: "close_ask", trayAvailable: true });
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(document.activeElement).toBe(cancel);
    // DismissableLayer installs the outside pointer listener on the next task.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (method === "cancel") fireEvent.click(cancel);
    else if (method === "escape") fireEvent.keyDown(cancel, { key: "Escape" });
    else {
      fireEvent.pointerDown(
        document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement,
        { pointerType: "mouse", button: 0 },
      );
      const overlay = document.querySelector(
        '[data-slot="dialog-overlay"]',
      ) as HTMLElement;
      fireEvent.pointerUp(overlay, { pointerType: "mouse", button: 0 });
      fireEvent.click(overlay);
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(decisions(calls)).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(previous));
    emit({ type: "close_ask", trayAvailable: false });
    expect(screen.getByRole("dialog")).toBeTruthy();
  },
);

test.each([true, false])(
  "tray availability sets the only valid default (%s)",
  async (trayAvailable) => {
    const { emit, calls } = mount();
    emit({ type: "close_ask", trayAvailable });
    const tray = screen.getByRole("radio", { name: "隐藏到托盘" });
    expect(tray.hasAttribute("disabled")).toBe(!trayAvailable);
    expect(tray.getAttribute("aria-checked")).toBe(String(trayAvailable));
    expect(
      screen
        .getByRole("radio", { name: "退出应用" })
        .getAttribute("aria-checked"),
    ).toBe(String(!trayAvailable));
    if (!trayAvailable)
      expect(screen.getByText("托盘不可用，无法隐藏。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(decisions(calls)).toEqual([
      [
        "app_window_close_decide",
        { input: { action: trayAvailable ? "tray" : "exit", remember: false } },
      ],
    ]);
  },
);

test("remembered choice is exact and pending blocks all controls and dismissal", async () => {
  let resolve!: (value: null) => void;
  const waiting = new Promise<null>((done) => {
    resolve = done;
  });
  const { emit, calls } = mount({
    override: (name) =>
      name === "app_window_close_decide" ? waiting : undefined,
  });
  emit({ type: "close_ask", trayAvailable: true });
  fireEvent.click(screen.getByRole("radio", { name: "退出应用" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  const dialog = screen.getByRole("dialog");
  for (const control of within(dialog).getAllByRole("button"))
    expect(control.hasAttribute("disabled")).toBe(true);
  for (const control of within(dialog).getAllByRole("radio"))
    expect(control.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(decisions(calls)).toEqual([
    ["app_window_close_decide", { input: { action: "exit", remember: true } }],
  ]);
  await act(async () => resolve(null));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("overridden remember stays open and can retry without remembering", async () => {
  const { emit, calls } = mount({
    override: (command, payload) => {
      if (
        command === "app_window_close_decide" &&
        (payload as { input: { remember: boolean } }).input.remember
      )
        return Promise.reject(failure("app.settings.overridden"));
    },
  });
  emit({ type: "close_ask", trayAvailable: true });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "关闭方式已被配置固定，无法记住；取消勾选后仍可本次执行。",
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(decisions(calls).map(([, payload]) => payload)).toEqual([
    { input: { action: "tray", remember: true } },
    { input: { action: "tray", remember: false } },
  ]);
});

test.each([
  "app.lifecycle.closing",
  "app.input.invalid",
  "app.native.unavailable",
])("decision error %s follows its lifecycle", async (code) => {
  const notify = vi.spyOn(toast, "error");
  const { emit } = mount({
    override: (command) =>
      command === "app_window_close_decide"
        ? Promise.reject(failure(code))
        : undefined,
  });
  emit({ type: "close_ask", trayAvailable: false });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  if (code === "app.native.unavailable") {
    expect((await screen.findByRole("alert")).textContent).toContain(
      "window-test",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    if (code === "app.input.invalid")
      expect(notify).toHaveBeenCalledExactlyOnceWith(
        "关闭询问已过期，请重新关闭窗口。",
      );
    else expect(notify).not.toHaveBeenCalled();
  }
});

test("close-button focus returns even when the host asks during the pending command", async () => {
  let ask!: () => void;
  const { emit } = mount({
    override: (command) => {
      if (command === "app_window_close") {
        ask();
        return null;
      }
    },
  });
  ask = () => emit({ type: "close_ask", trayAvailable: true });
  const close = screen.getByRole("button", { name: "关闭" });
  close.focus();
  await act(async () => fireEvent.click(close));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(document.activeElement).toBe(close));
});

test.each([
  ["最小化", "app_window_minimize"],
  ["最大化", "app_window_toggle_maximize"],
  ["关闭", "app_window_close"],
])(
  "window action %s blocks double clicks and reports IPC errors",
  async (label, command) => {
    let reject!: (error: IpcError) => void;
    const waiting = new Promise<null>((_, fail) => {
      reject = fail;
    });
    const notify = vi.spyOn(toast, "error");
    const { calls } = mount({
      override: (name) => (name === command ? waiting : undefined),
    });
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    for (const button of within(screen.getByRole("group")).getAllByRole(
      "button",
    ))
      expect(button.hasAttribute("disabled")).toBe(true);
    await act(async () => reject(failure("app.native.unavailable")));
    expect(calls.mock.calls.filter(([name]) => name === command)).toHaveLength(
      1,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toEqual({
      description: "追踪 ID：window-test",
    });
    expect(
      screen.getByRole("button", { name: label }).hasAttribute("disabled"),
    ).toBe(false);
  },
);

test("native chrome keeps subscription without rendering controls", () => {
  const { emit, channels } = mount({ titlebar: "native" });
  expect(screen.queryByRole("group", { name: "窗口控制" })).toBeNull();
  expect(channels).toHaveLength(1);
  emit({ type: "close_ask", trayAvailable: true });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("Mac hidden-titlebar delegates drag/double-click once and removes the listener", async () => {
  const previous = testPlatform;
  testPlatform = "macos";
  const header = document.createElement("header");
  header.dataset.windowDrag = "";
  header.style.setProperty("--window-drag-allowed", "1");
  try {
    const view = mount({ strict: true });
    view.container.append(header);
    const init = { button: 0, buttons: 1, detail: 1 };
    expect(fireEvent.mouseDown(header, init)).toBe(false);
    fireEvent.mouseDown(header, { ...init, detail: 2 });
    await waitFor(() => {
      expect(
        view.calls.mock.calls.filter(
          ([name]) => name === "app_window_start_dragging",
        ),
      ).toHaveLength(1);
      expect(
        view.calls.mock.calls.filter(
          ([name]) => name === "app_window_toggle_maximize",
        ),
      ).toHaveLength(1);
    });
    view.rerender(
      <StrictMode>
        <WindowChromeProvider platform={testPlatform} titlebar="native">
          <span>Native</span>
        </WindowChromeProvider>
      </StrictMode>,
    );
    document.body.append(header);
    expect(fireEvent.mouseDown(header, init)).toBe(true);
    expect(
      view.calls.mock.calls.filter(
        ([name]) => name === "app_window_start_dragging",
      ),
    ).toHaveLength(1);
    view.unmount();
    fireEvent.mouseDown(header, init);
    expect(
      view.calls.mock.calls.filter(
        ([name]) => name === "app_window_start_dragging",
      ),
    ).toHaveLength(1);
  } finally {
    header.remove();
    testPlatform = previous;
  }
});

test.each(["windows", "linux"] as const)(
  "%s preserves its existing drag implementation",
  (platform) => {
    const previous = testPlatform;
    testPlatform = platform;
    try {
      const view = mount();
      const header = document.createElement("header");
      header.dataset.windowDrag = "";
      header.style.setProperty("--window-drag-allowed", "1");
      view.container.append(header);
      fireEvent.mouseDown(header, { button: 0, buttons: 1, detail: 1 });
      fireEvent.mouseDown(header, { button: 0, buttons: 1, detail: 2 });
      expect(
        view.calls.mock.calls.filter(
          ([name]) =>
            name === "app_window_start_dragging" ||
            name === "app_window_toggle_maximize",
        ),
      ).toHaveLength(0);
    } finally {
      testPlatform = previous;
    }
  },
);

test("Mac drag failure is reported through the existing IPC error feedback", async () => {
  const previous = testPlatform;
  testPlatform = "macos";
  const notify = vi.spyOn(toast, "error");
  try {
    const view = mount({
      override: (name) =>
        name === "app_window_start_dragging"
          ? Promise.reject(failure("app.native.unavailable"))
          : undefined,
    });
    const header = document.createElement("header");
    header.dataset.windowDrag = "";
    header.style.setProperty("--window-drag-allowed", "1");
    view.container.append(header);
    fireEvent.mouseDown(header, { button: 0, buttons: 1, detail: 1 });
    await waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(notify.mock.calls[0][1]).toEqual({
      description: "追踪 ID：window-test",
    });
  } finally {
    testPlatform = previous;
  }
});

test("pure controls preserve identifiers, glyphs, click handlers and disabled state", () => {
  const handlers = {
    onMinimize: vi.fn(),
    onToggleMaximize: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <WindowControls {...handlers} maximized={false} focused pending={false} />,
  );
  for (const [label, control, handler] of [
    ["最小化", "minimize", handlers.onMinimize],
    ["最大化", "maximize", handlers.onToggleMaximize],
    ["关闭", "close", handlers.onClose],
  ] as const) {
    const button = screen.getByRole("button", { name: label });
    expect(button.dataset.windowControl).toBe(control);
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(handler).toHaveBeenCalledTimes(1);
  }
  expect(
    screen
      .getByRole("button", { name: "最大化" })
      .querySelector(".lucide-square"),
  ).not.toBeNull();
  view.rerender(
    <WindowControls {...handlers} maximized focused={false} pending />,
  );
  const group = screen.getByRole("group", { name: "窗口控制" });
  expect(group.dataset).toMatchObject({
    shell: "window-controls",
    windowFocused: "false",
    windowMaximized: "true",
  });
  const restore = screen.getByRole("button", { name: "还原" });
  expect(restore.dataset.windowControl).toBe("maximize");
  expect(restore.querySelector(".lucide-window-restore")).not.toBeNull();
  fireEvent.click(restore);
  expect(handlers.onToggleMaximize).toHaveBeenCalledTimes(1);
});
