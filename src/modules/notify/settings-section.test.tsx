import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import { activeAuth } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import { notifyManifest } from "./manifest";
import { mockNotifyIpc, renderNotify } from "./notifications.test-support";
import { notifyParams } from "./notify.test-support";

test("通知分节保留桌面总开关并嵌入全部偏好参数", async () => {
  const calls = mockNotifyIpc(undefined, {
    desktopNotifications: { value: true, source: "file" },
  });
  renderNotify("/settings/notify");
  const control = await screen.findByRole("switch", {
    name: i18n.t("settings.desktopNotifications"),
  });
  expect(control.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("测试桌面通知")).toBeTruthy();
  fireEvent.click(control);
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_settings_update", {
      input: { desktopNotifications: false },
    }),
  );
  await screen.findByRole("heading", { name: "通知偏好" });
  for (const entry of notifyParams)
    expect(screen.getAllByText(i18n.t(`param.${entry.key}.name`))).toHaveLength(
      1,
    );
  expect(calls).toHaveBeenCalledWith("app_setting_list", {
    input: { includeDisabled: false },
  });
});

test.each(["sent", "disabled", "failed"] as const)(
  "测试通知显示 %s 状态并刷新未读数",
  async (desktop) => {
    let count = 0;
    const calls = mockNotifyIpc((name) => {
      if (name === "notify_unread_count") return count;
      if (name === "notify_test_send") {
        count = 1;
        return { desktop };
      }
    });
    renderNotify("/settings/notify");
    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    const status = await screen.findByText(
      i18n.t(`notify.settings.testResult.${desktop}`),
    );
    expect(status.getAttribute("role")).toBe("status");
    expect(calls).toHaveBeenCalledWith("notify_test_send", {});
    await screen.findByLabelText("1 条未读通知");
  },
);

test("清单通过 paramGroups 独占认领偏好组，并贡献懒加载部件", async () => {
  expect(
    notifyManifest.routes.map(({ path, permission }) => [path, permission]),
  ).toEqual([["/notify", undefined]]);
  expect(notifyManifest.nav).toEqual([]);
  expect(notifyManifest.settings).toHaveLength(1);
  expect(notifyManifest.settings[0].paramGroups).toEqual([
    "notify.preferences",
  ]);
  expect(
    notifyManifest.headerWidgets.map(({ id, order }) => [id, order]),
  ).toEqual([
    ["notify.bell", 10],
    ["notify.toasts", 20],
  ]);
  for (const contribution of [
    ...notifyManifest.routes,
    ...notifyManifest.settings,
    ...notifyManifest.headerWidgets,
  ]) {
    expect((await contribution.Component()).default).toBeTypeOf("function");
  }
});

test.each(["environment", "commandLine"] as const)(
  "桌面开关遵守 %s 来源锁定",
  async (source) => {
    const calls = mockNotifyIpc(undefined, {
      desktopNotifications: { value: true, source },
    });
    renderNotify("/settings/notify");
    const control = await screen.findByRole("switch", {
      name: i18n.t("settings.desktopNotifications"),
    });
    expect(control.hasAttribute("disabled")).toBe(true);
    fireEvent.click(control);
    expect(
      calls.mock.calls.some(([name]) => name === "app_settings_update"),
    ).toBe(false);
  },
);

test("测试发送 pending 时禁止重复提交，失败显示错误", async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise<never>((_, fail) => {
    reject = fail;
  });
  const calls = mockNotifyIpc((name) =>
    name === "notify_test_send" ? pending : undefined,
  );
  renderNotify("/settings/notify");
  const button = await screen.findByRole("button", { name: "发送" });
  fireEvent.click(button);
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
  fireEvent.click(button);
  expect(
    calls.mock.calls.filter(([name]) => name === "notify_test_send"),
  ).toHaveLength(1);
  await act(async () =>
    reject({
      code: "app.internal.unexpected",
      params: {},
      traceId: "test-notify-failed",
    }),
  );
  await screen.findByText(/test-notify-failed/);
  expect(button.hasAttribute("disabled")).toBe(false);
});

test("身份锁定清除测试通知结果与设置表单", async () => {
  mockNotifyIpc((name) =>
    name === "notify_test_send" ? { desktop: "sent" } : undefined,
  );
  const view = renderNotify("/settings/notify");
  fireEvent.click(await screen.findByRole("button", { name: "发送" }));
  await screen.findByText(i18n.t("notify.settings.testResult.sent"));
  await act(async () => {
    view.client.setQueryData(authKey, { ...activeAuth, state: "locked" });
  });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "发送" })).toBeNull(),
  );
  expect(
    screen.queryByText(i18n.t("notify.settings.testResult.sent")),
  ).toBeNull();
});
