import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { activeAuth } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import type { WindowEvent } from "@/lib/generated/WindowEvent";
import type { Channel } from "@/lib/ipc/invoke";
import { mockAppIpc, renderApp } from "./app.test-support";

async function dirtySettings() {
  const editor = await screen.findByRole("textbox", {
    name: "空闲自动锁定（分钟）",
  });
  fireEvent.change(editor, { target: { value: "25" } });
}

test("草稿跨设置子路由和外壳转场保留，离开时可继续或放弃", async () => {
  mockAppIpc();
  const { router } = renderApp("/settings/security");
  await dirtySettings();
  const actions = screen.getByRole("region", { name: "设置操作" });
  await act(async () => {
    await router.navigate("/settings/appearance");
  });
  expect(screen.getByRole("region", { name: "设置操作" })).toBe(actions);
  await act(async () => {
    await router.navigate("/settings/security");
  });
  expect(
    await screen.findByRole("textbox", { name: "空闲自动锁定（分钟）" }),
  ).toHaveProperty("value", "25");
  await act(async () => {
    await router.navigate("/");
  });
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "继续编辑",
    }),
  );
  expect(router.state.location.pathname).toBe("/settings/security");
  await act(async () => {
    await router.navigate("/");
  });
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "放弃修改",
    }),
  );
  await screen.findByRole("heading", { name: i18n.t("app.name") });
});

test("原生关闭经过草稿确认，clean 成功发布后才批准 requestId", async () => {
  const channels: Channel<WindowEvent>[] = [];
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_window_watch") {
      channels.push((payload as { onEvent: Channel<WindowEvent> }).onEvent);
      return null;
    }
  });
  renderApp("/settings/security");
  await dirtySettings();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: true, pending: false },
    }),
  );
  act(() =>
    channels[0].onmessage({ type: "close_edit", requestId: "cancel-close" }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "继续编辑",
    }),
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId: "cancel-close", proceed: false },
    }),
  );
  calls.mockClear();
  act(() =>
    channels[0].onmessage({ type: "close_edit", requestId: "approve-close" }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "放弃修改",
    }),
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId: "approve-close", proceed: true },
    }),
  );
  const clean = calls.mock.calls.findIndex(
    ([command, payload]) =>
      command === "app_window_edit_state" &&
      (payload as { input: { dirty: boolean } }).input.dirty === false,
  );
  const approve = calls.mock.calls.findIndex(
    ([command, payload]) =>
      command === "app_window_edit_decide" &&
      (payload as { input: { proceed: boolean } }).input.proceed,
  );
  expect(clean).toBeGreaterThanOrEqual(0);
  expect(clean).toBeLessThan(approve);
});

test("锁定卸载草稿，重新认证不能恢复旧身份输入", async () => {
  mockAppIpc();
  const { client } = renderApp("/settings/security");
  await dirtySettings();
  act(() =>
    client.setQueryData(["account", "auth"], {
      ...activeAuth,
      mode: "login",
      state: "locked",
      permissions: [],
    }),
  );
  await screen.findByRole("heading", { name: "已锁定" });
  act(() => client.setQueryData(["account", "auth"], activeAuth));
  expect(
    await screen.findByRole("textbox", { name: "空闲自动锁定（分钟）" }),
  ).toHaveProperty("value", "15");
});

test("clean 发布失败不批准原生关闭，可在错误提示后重试", async () => {
  const channels: Channel<WindowEvent>[] = [];
  let rejectClean = false;
  const calls = mockAppIpc((command, payload) => {
    if (command === "app_window_watch") {
      channels.push((payload as { onEvent: Channel<WindowEvent> }).onEvent);
      return null;
    }
    if (
      command === "app_window_edit_state" &&
      rejectClean &&
      !(payload as { input: { dirty: boolean } }).input.dirty
    )
      throw {
        code: "app.cache.unavailable",
        params: {},
        traceId: "clean-failed",
      };
  });
  renderApp("/settings/security");
  await dirtySettings();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: true, pending: false },
    }),
  );
  rejectClean = true;
  act(() =>
    channels[0].onmessage({ type: "close_edit", requestId: "retry-close" }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "放弃修改",
    }),
  );
  const dialog = screen.getByRole("alertdialog");
  expect((await within(dialog).findByRole("alert")).textContent).toContain(
    "clean-failed",
  );
  expect(
    calls.mock.calls.some(
      ([command, payload]) =>
        command === "app_window_edit_decide" &&
        (payload as { input: { proceed: boolean } }).input.proceed,
    ),
  ).toBe(false);
  rejectClean = false;
  fireEvent.click(within(dialog).getByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId: "retry-close", proceed: true },
    }),
  );
});
