import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { activeAuth } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import type { NotificationListInput } from "@/lib/generated/NotificationListInput";
import {
  fixtureJobKind,
  item,
  jobId,
  mockNotifyIpc,
  renderNotify,
} from "./notifications.test-support";

afterEach(() => vi.useRealTimers());

test("铃铛显示未读数、每 30 秒和窗口聚焦刷新，卸载停止轮询", async () => {
  let count = 2;
  const calls = mockNotifyIpc((command) =>
    command === "notify_unread_count" ? count : undefined,
  );
  const view = renderNotify();
  await screen.findByLabelText("2 条未读通知");
  vi.useFakeTimers();
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: ["notify", "notifications"],
    });
    await vi.advanceTimersByTimeAsync(1);
  });
  const numberOfCalls = () =>
    calls.mock.calls.filter(([name]) => name === "notify_unread_count").length;
  const before = numberOfCalls();
  count = 3;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_010);
  });
  expect(numberOfCalls()).toBe(before + 1);
  expect(screen.getByLabelText("3 条未读通知")).toBeTruthy();
  count = 4;
  await act(async () => {
    fireEvent.focus(window);
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByLabelText("4 条未读通知")).toBeTruthy();
  view.unmount();
  const stopped = numberOfCalls();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(numberOfCalls()).toBe(stopped);
});

test("面板引用翻译标题正文，先标已读再跳转", async () => {
  let read = false;
  const calls = mockNotifyIpc(
    (command) => {
      if (command === "notify_unread_count") return read ? 0 : 1;
      if (command === "notify_list")
        return {
          items: [{ ...item, readAt: read ? item.createdAt : null }],
          total: 1,
          page: 1,
          pageSize: 5,
        };
      if (command === "notify_mark_read") {
        read = true;
        return null;
      }
    },
    { developerMode: { value: true, source: "file" } },
  );
  const view = renderNotify();
  fireEvent.click(await screen.findByRole("button", { name: "通知" }));
  const panel = within(screen.getByRole("region", { name: "通知中心" }));
  await panel.findByText(
    `${i18n.t(`jobs.kinds.${fixtureJobKind}`)}失败：${i18n.t("errors.app.input.invalid", { path: "payload" })}`,
  );
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  fireEvent.click(panel.getByRole("button", { name: /任务失败/ }));
  await screen.findByRole("heading", { name: "任务详情" });
  expect(view.router.state.location.pathname).toBe(`/devtools/jobs/${jobId}`);
  expect(calls).toHaveBeenCalledWith("notify_mark_read", {
    input: { ids: [item.id] },
  });
  expect(screen.queryByRole("region", { name: "通知中心" })).toBeNull();
  expect(screen.queryByLabelText("1 条未读通知")).toBeNull();
});

test.each([
  ["enabled", true, true, true, jobId, true],
  ["disabled", false, true, true, jobId, true],
  ["denied", true, false, true, jobId, true],
  ["unregistered", true, true, false, jobId, true],
  ["no_job", true, true, true, null, true],
  ["mode_off", true, true, true, jobId, false],
] as const)(
  "任务目的地遵守共享门控：%s",
  async (_, enabled, permitted, registered, target, developerMode) => {
    let read = false;
    const calls = mockNotifyIpc(
      (command) => {
        if (command === "account_auth_status")
          return {
            ...activeAuth,
            permissions: permitted ? ["devtools.job.read"] : [],
          };
        if (command === "app_modules_list")
          return {
            modules: [
              { id: "notify", enabled: true },
              { id: "devtools", enabled },
            ],
          };
        if (command === "notify_list")
          return {
            items: [
              { ...item, jobId: target, readAt: read ? item.createdAt : null },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          };
        if (command === "notify_mark_read") {
          read = true;
          return null;
        }
      },
      { developerMode: { value: developerMode, source: "file" } },
    );
    const view = renderNotify("/notify", { registered });
    await screen.findByRole("button", { name: /任务失败/ });
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    expect(item).not.toHaveProperty("link");
    fireEvent.click(screen.getByRole("button", { name: /任务失败/ }));
    const opens =
      enabled && permitted && registered && developerMode && target !== null;
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("notify_mark_read", {
        input: { ids: [item.id] },
      }),
    );
    if (opens) await screen.findByRole("heading", { name: "任务详情" });
    else {
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "标为已读" })).toBeNull(),
      );
      expect(screen.getByRole("heading", { name: "通知中心" })).toBeTruthy();
      expect(
        calls.mock.calls.some(([name]) => name.startsWith("devtools_")),
      ).toBe(false);
    }
  },
);

test("面板全部已读、查看全部入口与 Escape 关闭", async () => {
  let unread = 1;
  const calls = mockNotifyIpc((command) => {
    if (command === "notify_unread_count") return unread;
    if (command === "notify_list")
      return { items: [item], total: 1, page: 1, pageSize: 5 };
    if (command === "notify_mark_all_read") {
      unread = 0;
      return null;
    }
  });
  renderNotify();
  const bell = await screen.findByRole("button", { name: "通知" });
  fireEvent.click(bell);
  await screen.findByText("任务失败");
  expect(screen.getByRole("region", { name: "通知中心" }).dataset.kit).toBe(
    "popover",
  );
  fireEvent.click(screen.getByRole("button", { name: "全部标为已读" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("1 条未读通知")).toBeNull(),
  );
  expect(calls).toHaveBeenCalledWith("notify_mark_all_read", {});
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "通知中心" })).toBeNull();
  fireEvent.click(bell);
  fireEvent.click(screen.getByRole("link", { name: "查看全部" }));
  await screen.findByRole("heading", { name: "通知中心" });
});

test("通知页分页、未读筛选重置页码和单条已读", async () => {
  const calls = mockNotifyIpc((command, payload) => {
    if (command === "notify_list") {
      const input = (payload as { input: NotificationListInput }).input;
      return {
        items: [{ ...item, id: `notification-${input.page}` }],
        total: 21,
        ...input,
      };
    }
  });
  renderNotify("/notify");
  await screen.findByText("第 1 / 2 页，共 21 条");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("第 2 / 2 页，共 21 条");
  expect(calls).toHaveBeenCalledWith("notify_list", {
    input: { page: 2, pageSize: 20, unreadOnly: false },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "只看未读" }));
  await screen.findByText("第 1 / 2 页，共 21 条");
  expect(calls).toHaveBeenCalledWith("notify_list", {
    input: { page: 1, pageSize: 20, unreadOnly: true },
  });
  fireEvent.click(screen.getByRole("button", { name: "标为已读" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("notify_mark_read", {
      input: { ids: ["notification-1"] },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "全部标为已读" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("notify_mark_all_read", {}),
  );
});

test("已读失败展示错误并留在通知页", async () => {
  mockNotifyIpc(
    (command) => {
      if (command === "notify_list")
        return { items: [item], total: 1, page: 1, pageSize: 20 };
      if (command === "notify_mark_read")
        throw {
          code: "app.internal.unexpected",
          params: {},
          traceId: "mark-failed",
        };
    },
    { developerMode: { value: true, source: "file" } },
  );
  const view = renderNotify("/notify");
  fireEvent.click(await screen.findByRole("button", { name: /任务失败/ }));
  await screen.findByText(/mark-failed/);
  expect(view.router.state.location.pathname).toBe("/notify");
});

test("已读等待期间撤回任务权限，完成后只标已读", async () => {
  let finish!: () => void;
  const pending = new Promise<null>((resolve) => {
    finish = () => resolve(null);
  });
  const calls = mockNotifyIpc(
    (command) => {
      if (command === "notify_list")
        return { items: [item], total: 1, page: 1, pageSize: 20 };
      if (command === "notify_mark_read") return pending;
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
    view.client.setQueryData(["account", "auth"], {
      ...activeAuth,
      permissions: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => finish());
  expect(view.router.state.location.pathname).toBe("/notify");
});
