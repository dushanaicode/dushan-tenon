import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import {
  activeAuth,
  appModules,
  currentUser,
  paramEntries,
} from "@/core/core.test-support";
import { toast } from "@/kit";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { NotificationItem } from "@/lib/generated/NotificationItem";
import { mockNotifyIpc, renderNotify } from "./notifications.test-support";
import { notifyParams } from "./notify.test-support";

vi.mock("sonner", async (importOriginal) => {
  const original = await importOriginal<typeof import("sonner")>();
  return {
    ...original,
    toast: Object.assign(vi.fn(original.toast), original.toast),
  };
});

afterEach(() => {
  toast.dismiss();
  vi.mocked(toast).mockClear();
  vi.useRealTimers();
});

function notification(
  id: string,
  time: number,
  jobId: string | null = null,
): NotificationItem {
  return {
    id,
    category: "test",
    titleKey: "notify.test.title",
    bodyKey: "notify.test.body",
    params: {},
    jobId,
    readAt: null,
    createdAt: new Date(time).toISOString(),
  };
}

const listKey = ["notify", "notifications", currentUser.id, "list", 1, 5, true];

test("共享铃铛未读数，零未读不读列表，新通知到达后开始提示", async () => {
  let items: NotificationItem[] = [];
  const calls = mockNotifyIpc((command) => {
    if (command === "notify_unread_count") return items.length;
    if (command === "notify_list")
      return { items, total: items.length, page: 1, pageSize: 5 };
  });
  const view = renderNotify("/", { toasts: true });
  await waitFor(() =>
    expect(view.client.getQueryState(listKey)?.fetchStatus).toBe("idle"),
  );
  await waitFor(() =>
    expect(
      view.client.getQueryData([
        "notify",
        "notifications",
        currentUser.id,
        "unread",
      ]),
    ).toBe(0),
  );
  expect(calls.mock.calls.some(([command]) => command === "notify_list")).toBe(
    false,
  );
  expect(
    calls.mock.calls.filter(([command]) => command === "notify_unread_count"),
  ).toHaveLength(1);
  expect(toast).not.toHaveBeenCalled();
  items = [notification("first-unread", Date.now() + 60_000)];
  fireEvent.focus(window);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(calls).toHaveBeenCalledWith("notify_list", {
    input: { page: 1, pageSize: 5, unreadOnly: true },
  });
  expect(
    calls.mock.calls.filter(([command]) => command === "notify_unread_count"),
  ).toHaveLength(2);
});

async function setup(
  preferences: Record<string, string> = {},
  developerMode = false,
) {
  const now = Date.now();
  const state = {
    items: [notification("old", now - 60_000)],
    params: notifyParams.map((entry) => ({
      ...entry,
      value: preferences[entry.key] ?? entry.value,
    })),
  };
  const calls = mockNotifyIpc(
    (command) => {
      if (command === "notify_unread_count")
        return state.items.filter((item) => item.readAt === null).length;
      if (command === "notify_mark_read") return null;
      if (command === "app_setting_list")
        return [
          ...paramEntries.filter((entry) => entry.moduleId !== "notify"),
          ...state.params,
        ];
      if (command === "notify_list")
        return {
          items: state.items,
          total: state.items.length,
          page: 1,
          pageSize: 5,
        };
    },
    { developerMode: { value: developerMode, source: "default" } },
  );
  const view = renderNotify("/", { toasts: true });
  await waitFor(() =>
    expect(view.client.getQueryState(listKey)?.status).toBe("success"),
  );
  return {
    ...view,
    state,
    calls,
    time: now + 60_000,
    refresh: () =>
      act(async () => {
        await view.client.invalidateQueries({ queryKey: listKey });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }),
  };
}

test("首轮历史通知不提示，新未读通知带正文和查看动作且不重复", async () => {
  const view = await setup();
  expect(toast).not.toHaveBeenCalled();
  expect(
    view.calls.mock.calls.filter(([command]) => command === "app_setting_list"),
  ).toHaveLength(0);
  view.state.items = [
    notification("new", view.time),
    {
      ...notification("read", view.time),
      readAt: new Date(view.time).toISOString(),
    },
  ];
  await view.refresh();
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(toast).toHaveBeenCalledWith(
    "测试通知",
    expect.objectContaining({
      description: "这是一条测试通知，说明通知渠道工作正常。",
      duration: 6000,
      position: "bottom-right",
    }),
  );
  await view.refresh();
  expect(toast).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByRole("button", { name: "查看" }));
  await waitFor(() =>
    expect(view.calls).toHaveBeenCalledWith("notify_mark_read", {
      input: { ids: ["new"] },
    }),
  );
  await waitFor(() =>
    expect(view.router.state.location.pathname).toBe("/notify"),
  );
});

test("关闭提示时仍查询新通知且再次开启不重播", async () => {
  const view = await setup({ "notify.in_app_toast": "false" });
  view.state.items = [notification("muted", view.time)];
  await view.refresh();
  await waitFor(() =>
    expect(
      view.calls.mock.calls.filter(
        ([command]) => command === "app_setting_list",
      ),
    ).toHaveLength(1),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(toast).not.toHaveBeenCalled();
  view.state.params = view.state.params.map((entry) =>
    entry.key === "notify.in_app_toast" ? { ...entry, value: "true" } : entry,
  );
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ["app", "setting"] });
  });
  expect(toast).not.toHaveBeenCalled();
  view.state.items = [notification("next", view.time + 1), ...view.state.items];
  await view.refresh();
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
});

test.each([true, false])(
  "任务提示遵守 useJobPath 门控：developerMode=%s",
  async (developerMode) => {
    const view = await setup({}, developerMode);
    const jobId = "01999000-1234-7000-8000-123456789abd";
    view.state.items = [notification("job-toast", view.time, jobId)];
    await view.refresh();
    const action = await screen.findByRole("button", { name: "查看" });
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    fireEvent.click(action);
    await waitFor(() =>
      expect(view.calls).toHaveBeenCalledWith("notify_mark_read", {
        input: { ids: ["job-toast"] },
      }),
    );
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe(
        developerMode ? `/devtools/jobs/${jobId}` : "/",
      ),
    );
  },
);

test("超过三条合并成一条摘要，查看标记本批通知并进入通知中心", async () => {
  const view = await setup();
  view.state.items = Array.from({ length: 5 }, (_, index) =>
    notification(`new-${index}`, view.time + index),
  );
  await view.refresh();
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(toast).toHaveBeenCalledWith(
    "有 5 条新通知",
    expect.objectContaining({ duration: 6000 }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "查看" }));
  await waitFor(() =>
    expect(view.calls).toHaveBeenCalledWith("notify_mark_read", {
      input: { ids: view.state.items.map((item) => item.id) },
    }),
  );
});

test.each([
  ["0", Infinity, "top-left"],
  ["60", 60_000, "top-center"],
  ["1", 1000, "bottom-center"],
  ["6", 6000, "top-right"],
  ["6", 6000, "bottom-left"],
  ["6", 6000, "bottom-right"],
])("提示停留 %s 秒并位于 %s / %s", async (seconds, duration, position) => {
  const view = await setup({
    "notify.toast_seconds": String(seconds),
    "notify.toast_position": String(position),
  });
  view.state.items = [notification("new", view.time)];
  await view.refresh();
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      "测试通知",
      expect.objectContaining({ duration, position }),
    ),
  );
});

test("三条新通知逐条提示；聚焦刷新和每三十秒轮询，卸载后停止", async () => {
  const view = await setup();
  view.state.items = [0, 1, 2].map((n) =>
    notification(`batch-${n}`, view.time + n),
  );
  fireEvent.focus(window);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(3));
  vi.useFakeTimers();
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: listKey });
    await vi.advanceTimersByTimeAsync(1);
  });
  const before = view.calls.mock.calls.filter(
    ([command]) => command === "notify_list",
  ).length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_010);
  });
  expect(
    view.calls.mock.calls.filter(([command]) => command === "notify_list")
      .length,
  ).toBeGreaterThan(before);
  expect(toast).toHaveBeenCalledTimes(3);
  view.unmount();
  const stopped = view.calls.mock.calls.length;
  await act(async () => {
    fireEvent.focus(window);
    await vi.advanceTimersByTimeAsync(30_010);
  });
  expect(
    view.calls.mock.calls
      .slice(stopped)
      .filter(([command]) => command.startsWith("notify_")),
  ).toEqual([]);
});

test.each(["disabled", "anonymous"] as const)(
  "模块停用或未认证不请求通知：%s",
  async (state) => {
    const calls = mockNotifyIpc((command) => {
      if (command === "app_modules_list" && state === "disabled")
        return {
          modules: appModules.modules.map((module) => ({
            ...module,
            enabled: module.id !== "notify",
          })),
        };
      if (command === "account_auth_status" && state === "anonymous")
        return {
          mode: "login",
          state: "anonymous",
          user: null,
          permissions: [],
          idleLockMinutes: 15,
        } satisfies AuthStatus;
    });
    const view = renderNotify("/", { toasts: true });
    await waitFor(() =>
      expect(view.client.getQueryState(authKey)?.status).toBe("success"),
    );
    if (state === "disabled")
      await waitFor(() =>
        expect(view.client.getQueryState(["app", "modules"])?.status).toBe(
          "success",
        ),
      );
    fireEvent.focus(window);
    expect(
      calls.mock.calls.some(([command]) => command.startsWith("notify_")),
    ).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  },
);

test.each(["disabled", "locked", "another-user"] as const)(
  "失去当前通知身份时清除 toast 且不重播：%s",
  async (state) => {
    const view = await setup();
    const dismiss = vi.spyOn(toast, "dismiss");
    view.state.items = [notification("visible", view.time)];
    await view.refresh();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const id = vi.mocked(toast).mock.calls[0][1]?.id;
    if (state === "another-user") view.state.items = [];
    await act(async () => {
      if (state === "disabled") {
        view.client.setQueryData(["app", "modules"], {
          modules: appModules.modules.map((module) => ({
            ...module,
            enabled: module.id !== "notify",
          })),
        });
      } else {
        view.client.setQueryData<AuthStatus>(authKey, {
          mode: "none",
          state: state === "locked" ? "locked" : "active",
          user:
            state === "locked"
              ? currentUser
              : { ...currentUser, id: "another-user" },
          permissions: [],
          idleLockMinutes: 15,
        });
      }
    });
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(id));
    expect(toast).toHaveBeenCalledTimes(1);
  },
);

test("toast 已读等待期间锁定，迟到结果不能导航", async () => {
  let finish!: () => void;
  const pending = new Promise<null>((resolve) => {
    finish = () => resolve(null);
  });
  const now = Date.now();
  const calls = mockNotifyIpc((command) => {
    if (command === "notify_unread_count") return 1;
    if (command === "notify_list")
      return {
        items: [notification("pending", now + 60_000)],
        total: 1,
        page: 1,
        pageSize: 5,
      };
    if (command === "notify_mark_read") return pending;
  });
  const view = renderNotify("/", { toasts: true });
  fireEvent.click(await screen.findByRole("button", { name: "查看" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("notify_mark_read", {
      input: { ids: ["pending"] },
    }),
  );
  await act(async () => {
    view.client.setQueryData(authKey, { ...activeAuth, state: "locked" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => finish());
  expect(view.router.state.location.pathname).toBe("/");
});
