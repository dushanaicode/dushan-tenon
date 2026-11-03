import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import { activeAuth, appModules, currentUser } from "@/core/core.test-support";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import {
  item,
  mockNotifyIpc,
  renderNotify,
} from "./notifications.test-support";

afterEach(() => vi.useRealTimers());

test.each(["disabled", "loading", "error"])(
  "模块%s不挂载铃铛、查询或 focus 监听",
  async (state) => {
    const add = vi.spyOn(window, "addEventListener");
    const calls = mockNotifyIpc((name) => {
      if (name !== "app_modules_list") return;
      if (state === "loading") return new Promise(() => {});
      if (state === "error")
        throw {
          code: "app.internal.unexpected",
          params: {},
          traceId: "modules",
        };
      return {
        modules: appModules.modules.map((module) => ({
          ...module,
          enabled: module.id !== "notify",
        })),
      };
    });
    const view = renderNotify("/notify", { toasts: true });
    await waitFor(() =>
      expect(view.client.getQueryState(["app", "modules"])?.status).toBe(
        state === "loading"
          ? "pending"
          : state === "error"
            ? "error"
            : "success",
      ),
    );
    fireEvent.focus(window);
    expect(screen.queryByRole("button", { name: "通知" })).toBeNull();
    expect(calls.mock.calls.some(([name]) => name.startsWith("notify_"))).toBe(
      false,
    );
    expect(add.mock.calls.filter(([type]) => type === "focus")).toHaveLength(0);
  },
);

test.each(["disabled", "loading", "error"])(
  "模块变成%s时移除 focus 并停止轮询",
  async (state) => {
    let changed = false;
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const calls = mockNotifyIpc((name) => {
      if (name === "app_modules_list" && changed) {
        if (state === "loading") return new Promise(() => {});
        if (state === "error")
          throw {
            code: "app.internal.unexpected",
            params: {},
            traceId: "modules-changed",
          };
        return {
          modules: appModules.modules.map((module) => ({
            ...module,
            enabled: module.id !== "notify",
          })),
        };
      }
      if (name === "notify_unread_count") return 2;
      if (name === "notify_list")
        return { items: [item], total: 1, page: 1, pageSize: 5 };
    });
    const view = renderNotify("/notify", { toasts: true });
    await screen.findByLabelText("2 条未读通知");
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    await screen.findByRole("region", { name: "通知中心" });
    const listeners = add.mock.calls.filter(([type]) => type === "focus");
    expect(listeners).toHaveLength(1);
    changed = true;
    await act(async () => {
      void view.client.resetQueries({ queryKey: ["app", "modules"] });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "通知" })).toBeNull(),
    );
    expect(screen.queryByRole("region", { name: "通知中心" })).toBeNull();
    expect(remove).toHaveBeenCalledWith("focus", listeners[0][1]);
    calls.mockClear();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.focus(window);
      await vi.advanceTimersByTimeAsync(60_010);
    });
    expect(calls.mock.calls.some(([name]) => name.startsWith("notify_"))).toBe(
      false,
    );
  },
);

test.each(["locked", "anonymous", "loading", "error"])(
  "身份%s不查询通知",
  async (state) => {
    const calls = mockNotifyIpc((name) => {
      if (name !== "account_auth_status") return;
      if (state === "loading") return new Promise(() => {});
      if (state === "error")
        throw { code: "app.internal.unexpected", params: {}, traceId: "auth" };
      return {
        ...activeAuth,
        mode: "login",
        state,
        user: state === "anonymous" ? null : currentUser,
        permissions: [],
      };
    });
    const view = renderNotify("/notify", { toasts: true });
    await waitFor(() =>
      expect(view.client.getQueryState(authKey)?.status).toBe(
        state === "loading"
          ? "pending"
          : state === "error"
            ? "error"
            : "success",
      ),
    );
    fireEvent.focus(window);
    expect(screen.queryByRole("button", { name: "通知" })).toBeNull();
    expect(calls.mock.calls.some(([name]) => name.startsWith("notify_"))).toBe(
      false,
    );
  },
);

test("未读缓存按用户隔离且身份切换关闭面板", async () => {
  let secondUser = false;
  let resolveCount!: (count: number) => void;
  const pending = new Promise<number>((resolve) => {
    resolveCount = resolve;
  });
  mockNotifyIpc((name) => {
    if (name === "notify_unread_count") return secondUser ? pending : 2;
    if (name === "notify_list")
      return { items: [item], total: 1, page: 1, pageSize: 5 };
  });
  const view = renderNotify();
  await screen.findByLabelText("2 条未读通知");
  fireEvent.click(screen.getByRole("button", { name: "通知" }));
  await screen.findByRole("region", { name: "通知中心" });
  secondUser = true;
  await act(async () => {
    view.client.setQueryData<AuthStatus>(authKey, {
      ...activeAuth,
      user: { ...currentUser, id: "second-user" },
    });
  });
  await waitFor(() =>
    expect(screen.queryByLabelText("2 条未读通知")).toBeNull(),
  );
  expect(screen.queryByRole("region", { name: "通知中心" })).toBeNull();
  expect(
    view.client.getQueryData([
      "notify",
      "notifications",
      currentUser.id,
      "unread",
    ]),
  ).toBe(2);
  await act(async () => resolveCount(7));
  await screen.findByLabelText("7 条未读通知");
});

test("旧身份迟到的已读结果不触发导航", async () => {
  let finish!: () => void;
  const pending = new Promise<null>((resolve) => {
    finish = () => resolve(null);
  });
  const calls = mockNotifyIpc(
    (name) => {
      if (name === "notify_list")
        return { items: [item], total: 1, page: 1, pageSize: 20 };
      if (name === "notify_mark_read") return pending;
    },
    { developerMode: { value: true, source: "file" } },
  );
  const view = renderNotify("/notify");
  await screen.findByRole("button", { name: /任务失败/ });
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  fireEvent.click(screen.getByRole("button", { name: /任务失败/ }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("notify_mark_read", {
      input: { ids: [item.id] },
    }),
  );
  await act(async () => {
    view.client.setQueryData(authKey, { ...activeAuth, state: "locked" });
  });
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "通知中心" })).toBeNull(),
  );
  await act(async () => finish());
  expect(view.router.state.location.pathname).toBe("/notify");
});
