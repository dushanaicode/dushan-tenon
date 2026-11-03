import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@/core/i18n";
import { createQueryClient } from "@/core/query-client";
import {
  appOperationCancel,
  appUpdateCheck,
  appUpdateDownload,
  appUpdateInstall,
  appUpdateStatus,
} from "@/lib/generated/commands";
import type { OperationProgress } from "@/lib/generated/OperationProgress";
import type { UpdateRelease } from "@/lib/generated/UpdateRelease";
import type { UpdateState } from "@/lib/generated/UpdateState";
import type { StreamChannel } from "@/lib/ipc/stream";
import { defaultNativeSettings, mockAppIpc } from "./settings.test-support";
import { UpdatePanel } from "./update-panel";

vi.mock("@/lib/generated/commands", async (original) => ({
  ...(await original<typeof import("@/lib/generated/commands")>()),
  appUpdateStatus: vi.fn(),
  appUpdateCheck: vi.fn(),
  appUpdateDownload: vi.fn(),
  appUpdateInstall: vi.fn(),
  appOperationCancel: vi.fn(),
}));

const release: UpdateRelease = {
  updateId: "0123456789abcdef0123456789abcdef",
  version: "0.2.0",
  publishedAt: null,
  notes: "<b>release text</b>",
  bytes: null,
};
const clients: ReturnType<typeof createQueryClient>[] = [];
function panel(configured: boolean, canEdit = true) {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          canEdit,
          updater: { ...defaultNativeSettings.updater, configured },
        }
      : undefined,
  );
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <UpdatePanel />
    </QueryClientProvider>,
  );
  return calls;
}
beforeEach(() => {
  vi.mocked(appUpdateStatus).mockReset().mockResolvedValue({ status: "idle" });
  vi.mocked(appUpdateCheck)
    .mockReset()
    .mockResolvedValue({ status: "available", release });
  vi.mocked(appUpdateDownload).mockReset();
  vi.mocked(appUpdateInstall).mockReset();
  vi.mocked(appOperationCancel).mockReset().mockResolvedValue(null);
});
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
  onlineManager.setEventListener((setOnline) => {
    const online = () => setOnline(true);
    const offline = () => setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  });
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

test("unconfigured_has_no_entry_or_network", async () => {
  vi.mocked(appUpdateStatus).mockResolvedValue({ status: "unconfigured" });
  const calls = panel(true);
  await waitFor(() =>
    expect(
      calls.mock.calls.some(
        ([command]) => command === "app_native_settings_get",
      ),
    ).toBe(true),
  );
  expect(screen.queryByText("应用更新")).toBeNull();
  await waitFor(() => expect(appUpdateStatus).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: "检查更新" })).toBeNull();
  expect(appUpdateDownload).not.toHaveBeenCalled();
  expect(appUpdateInstall).not.toHaveBeenCalled();
  expect(appUpdateCheck).not.toHaveBeenCalled();
});

test("owner_controls_and_plain_text_release_notes", async () => {
  panel(true);
  fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
  expect(await screen.findByText("<b>release text</b>")).toBeTruthy();
  expect(document.querySelector("b")).toBeNull();
  expect(screen.getByText(/0.2.0/)).toBeTruthy();
  expect(screen.getByText(/大小未知/)).toBeTruthy();
  expect(screen.getByText("下载后验证签名")).toBeTruthy();
  expect(appUpdateDownload).not.toHaveBeenCalled();
  expect(appUpdateInstall).not.toHaveBeenCalled();
});

test("配置状态由更新命令决定，原生设置的陈旧值不会隐藏可用面板", async () => {
  panel(false);
  expect(
    await screen.findByRole("button", { name: "检查更新" }),
  ).toHaveProperty("disabled", false);
  expect(appUpdateStatus).toHaveBeenCalledTimes(1);
  expect(appUpdateCheck).not.toHaveBeenCalled();
});

test("non_owner_cannot_start_check", async () => {
  panel(true, false);
  const check = await screen.findByRole("button", { name: "检查更新" });
  expect(check).toHaveProperty("disabled", true);
  fireEvent.click(check);
  expect(appUpdateCheck).not.toHaveBeenCalled();
});

test("active_background_check_can_refresh_memory_without_network", async () => {
  vi.mocked(appUpdateStatus)
    .mockResolvedValueOnce({ status: "checking" })
    .mockResolvedValueOnce({ status: "upToDate" });
  panel(true);
  fireEvent.click(
    await screen.findByRole("button", {
      name: i18n.t("settings.native.refresh"),
    }),
  );
  expect(await screen.findByText("当前已是最新版本。")).toBeTruthy();
  expect(appUpdateStatus).toHaveBeenCalledTimes(2);
  expect(appUpdateCheck).not.toHaveBeenCalled();
});

test("background_failure_is_visible_from_memory_status", async () => {
  vi.mocked(appUpdateStatus).mockResolvedValue({
    status: "failed",
    error: {
      code: "app.network.credentials_missing",
      params: {},
      traceId: "startup-check-error",
    },
  });
  panel(true);
  expect(await screen.findByText(/startup-check-error/)).toBeTruthy();
  expect(appUpdateCheck).not.toHaveBeenCalled();
});

test("only_stream_supplies_cancel_token_and_verified_enables_install", async () => {
  let channel: StreamChannel<OperationProgress> | undefined;
  let finish: ((state: UpdateState) => void) | undefined;
  vi.mocked(appUpdateStatus).mockResolvedValue({
    status: "available",
    release,
  });
  vi.mocked(appUpdateDownload).mockImplementation((_input, stream) => {
    channel = stream;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  panel(true);
  fireEvent.click(await screen.findByRole("button", { name: "下载更新" }));
  await waitFor(() => expect(channel).toBeDefined());
  const operationId = "abcdef0123456789abcdef0123456789";
  act(() => {
    if (!channel) throw new Error("download channel missing");
    channel.onmessage({
      type: "delta",
      seq: 1,
      data: {
        operationId,
        phase: "downloading",
        current: 10,
        total: null,
        unit: "bytes",
        canCancel: true,
      },
    });
  });
  fireEvent.click(await screen.findByRole("button", { name: "取消下载" }));
  expect(appOperationCancel).toHaveBeenCalledExactlyOnceWith({ operationId });
  expect(appUpdateDownload).toHaveBeenCalledWith(
    { updateId: release.updateId },
    expect.anything(),
  );
  await act(async () => {
    if (!finish) throw new Error("download resolver missing");
    finish({ status: "verified", release: { ...release, bytes: 42 } });
  });
  expect(await screen.findByText("签名及签名版本已验证")).toBeTruthy();
  expect(screen.getByRole("button", { name: "安装并重启" })).toBeTruthy();
});

test("install_failure_stops_without_requery_or_retry", async () => {
  vi.mocked(appUpdateStatus).mockResolvedValue({
    status: "verified",
    release: { ...release, bytes: 42 },
  });
  vi.mocked(appUpdateInstall).mockRejectedValue({
    code: "app.update.install_failed",
    params: {},
    traceId: "install-test",
  });
  const calls = panel(true);
  fireEvent.click(await screen.findByRole("button", { name: "安装并重启" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(appUpdateInstall).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "安装并重启" }));
  expect(
    await screen.findByText("应用已停止，请关闭后重新启动。"),
  ).toBeTruthy();
  expect(appUpdateStatus).toHaveBeenCalledTimes(1);
  expect(appUpdateInstall).toHaveBeenCalledExactlyOnceWith({
    updateId: release.updateId,
  });
  expect(screen.queryByRole("button", { name: "检查更新" })).toBeNull();
  expect(screen.queryByRole("button", { name: "安装并重启" })).toBeNull();
  const count = calls.mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(calls.mock.calls).toHaveLength(count);
  expect(appUpdateStatus).toHaveBeenCalledTimes(1);
});

test("rejection_before_shutdown_resumes_queries", async () => {
  vi.mocked(appUpdateStatus).mockResolvedValue({ status: "verified", release });
  vi.mocked(appUpdateInstall).mockRejectedValue({
    code: "app.update.invalid_release",
    params: {},
    traceId: "rejected-before-shutdown",
  });
  panel(true);
  fireEvent.click(await screen.findByRole("button", { name: "安装并重启" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "安装并重启",
    }),
  );
  expect(await screen.findByText(/rejected-before-shutdown/)).toBeTruthy();
  expect(onlineManager.isOnline()).toBe(true);
  expect(focusManager.isFocused()).toBe(true);
  expect(screen.getByRole("button", { name: "检查更新" })).toHaveProperty(
    "disabled",
    false,
  );
});
