import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import {
  appBackupExport,
  appBackupPrepareRestore,
  appBackupRestore,
  appOperationCancel,
} from "@/lib/generated/commands";
import type { FileArtifact } from "@/lib/generated/FileArtifact";
import type { IpcError } from "@/lib/generated/IpcError";
import type { OperationProgress } from "@/lib/generated/OperationProgress";
import type { RestorePlan } from "@/lib/generated/RestorePlan";
import type { StreamChannel } from "@/lib/ipc/stream";
import { currentUser, mockAppIpc, renderApp } from "./settings.test-support";

vi.mock("@/lib/generated/commands", async (original) => ({
  ...(await original<typeof import("@/lib/generated/commands")>()),
  appBackupExport: vi.fn(),
  appBackupPrepareRestore: vi.fn(),
  appBackupRestore: vi.fn(),
  appOperationCancel: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(appBackupExport).mockReset();
  vi.mocked(appBackupPrepareRestore).mockReset();
  vi.mocked(appBackupRestore).mockReset();
  vi.mocked(appOperationCancel).mockReset();
});

test.each(["remoteDatabase", "unsupportedStorage"] as const)(
  "data_shows_remote_and_private_data_limits: %s",
  async (availability) => {
    mockAppIpc((command) =>
      command === "app_data_status"
        ? { canManage: true, availability, operation: null, lastRestore: null }
        : undefined,
    );
    renderApp("/settings/data");
    expect(
      await screen.findByRole("button", { name: "创建备份" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(/备份未加密/)).toBeTruthy();
    expect(screen.getByText(/512 MiB/)).toBeTruthy();
    expect(screen.getByText(/不可逆验证哈希/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "验证并恢复" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByText(
        availability === "remoteDatabase" ? /数据库提供方/ : /不支持此存储布局/,
      ),
    ).toBeTruthy();
  },
);

const restorePlan: RestorePlan = {
  preparedId: "0123456789abcdef0123456789abcdef",
  productId: "fixture",
  appVersion: "0.1.0",
  createdAt: "2026-10-20T00:00:00Z",
  entries: 3,
  totalBytes: 4096,
  requiresUpgrade: true,
  excludesSecrets: true,
  encrypted: false,
  requiresRestart: true,
};

test("restore_preview_requires_confirmation_and_acceptance_is_not_success", async () => {
  vi.mocked(appBackupPrepareRestore).mockResolvedValue(restorePlan);
  vi.mocked(appBackupRestore).mockResolvedValue({
    operationId: restorePlan.preparedId,
    restartRequired: true,
  });
  const calls = mockAppIpc((command) =>
    command === "app_file_pick"
      ? {
          token: "restore-token",
          fileName: "copy.tenon-backup.zip",
          format: null,
        }
      : undefined,
  );
  renderApp("/settings/data");
  fireEvent.click(await screen.findByRole("button", { name: "验证并恢复" }));
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  expect(screen.getByText(/不会合并数据/)).toBeTruthy();
  expect(screen.getByText(/有效 10 分钟/)).toBeTruthy();
  expect(screen.getByText(/不会复制或删除凭据/)).toBeTruthy();
  expect(screen.getByText(/4096 字节/)).toBeTruthy();
  expect(appBackupRestore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(appBackupRestore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "验证并恢复" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认覆盖并重启" }),
  );
  expect(await screen.findByText(/这不代表恢复成功/)).toBeTruthy();
  expect(appBackupRestore).toHaveBeenCalledExactlyOnceWith({
    preparedId: restorePlan.preparedId,
  });
  expect(screen.queryByText("上次恢复已成功完成。")).toBeNull();
  expect(screen.getByRole("button", { name: "创建备份" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    calls.mock.calls.some(
      ([command, args]) =>
        command === "app_file_pick" &&
        (args as { input: { purpose: string } }).input.purpose ===
          "backuprestore",
    ),
  ).toBe(true);
});

test("redis_allows_export_but_not_restore_and_reports_final_outcome", async () => {
  mockAppIpc((command) =>
    command === "app_data_status"
      ? {
          canManage: true,
          availability: "unsupportedCache",
          operation: null,
          lastRestore: {
            status: "rolledBack",
            code: "app.backup.restore_failed",
          },
        }
      : undefined,
  );
  renderApp("/settings/data");
  expect(
    await screen.findByRole("button", { name: "创建备份" }),
  ).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "验证并恢复" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByText(/不会清空共享 Redis/)).toBeTruthy();
  expect(screen.getByText("上次恢复未完成，已回滚并保留原数据。")).toBeTruthy();
});

test("failed_commit_requires_new_verification_and_never_reports_success", async () => {
  vi.mocked(appBackupPrepareRestore).mockResolvedValue(restorePlan);
  vi.mocked(appBackupRestore).mockRejectedValue({
    code: "app.backup.restore_expired",
    params: {},
    traceId: "restore-failed",
  });
  mockAppIpc((command) =>
    command === "app_file_pick"
      ? {
          token: "restore-token",
          fileName: "copy.tenon-backup.zip",
          format: null,
        }
      : undefined,
  );
  renderApp("/settings/data");
  fireEvent.click(await screen.findByRole("button", { name: "验证并恢复" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认覆盖并重启" }),
  );
  expect(await screen.findByText(/恢复验证已过期/)).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByText(/恢复请求已接收/)).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "验证并恢复" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
});

test("non_owner_is_read_only_and_dialog_cancellation_is_quiet", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_data_status"
      ? {
          canManage: false,
          availability: "sqlite",
          operation: null,
          lastRestore: null,
        }
      : undefined,
  );
  const { unmount } = renderApp("/settings/data");
  expect(
    await screen.findByRole("button", { name: "创建备份" }),
  ).toHaveProperty("disabled", true);
  expect(
    calls.mock.calls.some(([command]) => command === "app_file_pick"),
  ).toBe(false);
  unmount();
  mockAppIpc((command) => (command === "app_file_pick" ? null : undefined));
  renderApp("/settings/data");
  fireEvent.click(await screen.findByRole("button", { name: "创建备份" }));
  expect(appBackupExport).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "继续并选择保存位置" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "创建备份" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(appBackupExport).not.toHaveBeenCalled();
});

test("progress_uses_server_token_and_waits_for_actual_cancel_result", async () => {
  const channels: StreamChannel<OperationProgress>[] = [];
  let rejectExport: ((error: IpcError) => void) | undefined;
  const pending = new Promise<FileArtifact>((_, reject) => {
    rejectExport = reject;
  });
  vi.mocked(appBackupExport).mockImplementation((_, channel) => {
    channels.push(channel);
    return pending;
  });
  vi.mocked(appOperationCancel).mockResolvedValue(null);
  mockAppIpc((command) => {
    if (command === "app_file_pick")
      return {
        token: "picked",
        fileName: "copy.tenon-backup.zip",
        format: null,
      };
    if (command === "app_stream_cancel") return null;
    return undefined;
  });
  renderApp("/settings/data");
  fireEvent.click(await screen.findByRole("button", { name: "创建备份" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "继续并选择保存位置" }),
  );
  await waitFor(() => expect(channels.length).toBe(1));
  const channel = channels[0];
  if (!channel || !rejectExport) throw new Error("Missing export request");
  const reject = rejectExport;
  const operationId = "a00112233445566778899aabbccddeeff";
  act(() => {
    channel.onmessage({ type: "started", streamId: "observer" });
    channel.onmessage({
      type: "delta",
      seq: 0,
      data: {
        operationId,
        phase: "copying",
        current: 128,
        total: 256,
        unit: "bytes",
        canCancel: true,
      },
    });
  });
  expect(screen.getByText("已完成 128 / 256 字节")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消备份" }));
  await waitFor(() =>
    expect(appOperationCancel).toHaveBeenCalledExactlyOnceWith({ operationId }),
  );
  expect(screen.queryByText(/备份已取消，原目标/)).toBeNull();
  await act(async () => {
    reject({
      code: "app.backup.cancelled",
      params: {},
      traceId: "cancel-trace",
    });
    await pending.catch(() => {});
  });
  expect(await screen.findByText("备份已取消，原目标保持不变。")).toBeTruthy();
  expect(screen.queryByText(/备份完成：/)).toBeNull();
});

test("export_reports_artifact_without_paths", async () => {
  vi.mocked(appBackupExport).mockResolvedValue({
    bytes: 321,
    sha256: "a".repeat(64),
  });
  const calls = mockAppIpc((command) =>
    command === "app_file_pick"
      ? { token: "picked", fileName: "copy.tenon-backup.zip", format: null }
      : undefined,
  );
  renderApp("/settings/data");
  fireEvent.click(await screen.findByRole("button", { name: "创建备份" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "继续并选择保存位置" }),
  );
  expect(await screen.findByText(/备份完成：321 字节/)).toBeTruthy();
  expect(calls).toHaveBeenCalledWith("app_file_pick", {
    input: {
      purpose: "backupexport",
    },
  });
  expect(appBackupExport).toHaveBeenCalledWith(
    { fileToken: "picked" },
    expect.anything(),
  );
});

test.each([
  ["account_auth_status", "success"],
  ["account_auth_status", "failure"],
  ["account_auth_status", "cancelled"],
  ["app_setting_list", "success"],
  ["app_setting_list", "failure"],
  ["app_setting_list", "cancelled"],
] as const)(
  "maintenance_busy_keeps_controls_and_refetches_after_%s_%s",
  async (blockedCommand, outcome) => {
    let maintenance = false;
    let resolveExport: ((artifact: FileArtifact) => void) | undefined;
    let rejectExport: ((error: IpcError) => void) | undefined;
    const completion = new Promise<FileArtifact>((resolve, reject) => {
      resolveExport = resolve;
      rejectExport = reject;
    });
    if (!resolveExport || !rejectExport)
      throw new Error("Missing export completion");
    const resolve = resolveExport;
    const reject = rejectExport;
    const channels: StreamChannel<OperationProgress>[] = [];
    vi.mocked(appBackupExport).mockImplementation((_, channel) => {
      maintenance = true;
      channels.push(channel);
      return completion;
    });
    vi.mocked(appOperationCancel).mockResolvedValue(null);
    const calls = mockAppIpc((command) => {
      if (maintenance && command === blockedCommand)
        return Promise.reject({
          code: "app.operation.busy",
          params: {},
          traceId: "maintenance-refresh",
        });
      if (command === "app_file_pick")
        return {
          token: "picked",
          fileName: "copy.tenon-backup.zip",
          format: null,
        };
      if (command === "app_stream_cancel") return null;
      return undefined;
    });
    const { client } = renderApp("/settings/data");
    fireEvent.click(await screen.findByRole("button", { name: "创建备份" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "继续并选择保存位置" }),
    );
    await waitFor(() => expect(channels).toHaveLength(1));
    const channel = channels[0];
    if (!channel) throw new Error("Missing backup channel");
    const operationId = "00112233445566778899aabbccddeeff";
    act(() => {
      channel.onmessage({ type: "started", streamId: "observer" });
      channel.onmessage({
        type: "delta",
        seq: 0,
        data: {
          operationId,
          phase: "copying",
          current: 128,
          total: 256,
          unit: "bytes",
          canCancel: true,
        },
      });
    });
    const cancelButton = screen.getByRole("button", { name: "取消备份" });
    const progress = screen.getByRole("progressbar", { name: "创建备份" });
    const queryKey =
      blockedCommand === "account_auth_status" ? authKey : ["app", "setting"];
    try {
      await act(async () => {
        await client.refetchQueries({ queryKey });
        // 查询完成后排空 QueryObserver 的默认异步通知，避免在旧 DOM 上误通过。
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(
        client
          .getQueriesData({ queryKey })
          .every(([, data]) => data !== undefined),
      ).toBe(true);
      expect(
        client.getQueryCache().find({ queryKey, exact: false })?.state.error,
      ).toMatchObject({ code: "app.operation.busy" });
      expect(screen.getByRole("button", { name: "取消备份" })).toBe(
        cancelButton,
      );
      expect(cancelButton).toHaveProperty("disabled", false);
      expect(screen.getByRole("progressbar", { name: "创建备份" })).toBe(
        progress,
      );
      expect(screen.getByText("已完成 128 / 256 字节")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      if (outcome === "cancelled") {
        fireEvent.click(cancelButton);
        await waitFor(() =>
          expect(appOperationCancel).toHaveBeenCalledExactlyOnceWith({
            operationId,
          }),
        );
      }
      const before = calls.mock.calls.length;
      const invalidations = vi.spyOn(client, "invalidateQueries");
      maintenance = false;
      await act(async () => {
        if (outcome === "success") {
          channel.onmessage({ type: "succeeded", data: null });
          resolve({ bytes: 256, sha256: "0".repeat(64) });
        } else {
          const code =
            outcome === "cancelled"
              ? "app.backup.cancelled"
              : "app.backup.export_failed";
          channel.onmessage({ type: "failed", code, params: {} });
          reject({
            code,
            params: {},
            traceId: "backup-result",
          });
        }
        await completion.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(
        calls.mock.calls
          .slice(before)
          .map(([command]) => command)
          .filter(
            (command) =>
              command === "account_auth_status" ||
              command === "app_setting_list",
          ),
      ).toEqual(["account_auth_status", "app_setting_list"]);
      expect(invalidations.mock.calls).toEqual([
        [{ queryKey: authKey }],
        [{ queryKey: ["app", "setting", currentUser.id] }],
      ]);
      expect(
        client.getQueryCache().find({ queryKey, exact: false })?.state.error,
      ).toBeNull();
      expect(screen.queryByRole("progressbar")).toBeNull();
      if (outcome === "success")
        expect(screen.getByText(/备份完成：256 字节/)).toBeTruthy();
      else
        expect(screen.getByRole("alert").textContent).toContain(
          outcome === "cancelled"
            ? "备份已取消，原目标保持不变。"
            : "备份导出失败，原目标保持不变。",
        );
    } finally {
      maintenance = false;
      await act(async () => {
        channel.onmessage({ type: "succeeded", data: null });
        resolve({ bytes: 256, sha256: "0".repeat(64) });
        await completion.catch(() => {});
      });
    }
  },
);

test("parameter_busy_without_previous_data_keeps_error_handling", async () => {
  mockAppIpc((command) =>
    command === "app_setting_list"
      ? Promise.reject({
          code: "app.operation.busy",
          params: {},
          traceId: "first-parameter-load",
        })
      : undefined,
  );
  renderApp("/settings/data");
  expect((await screen.findByRole("alert")).textContent).toContain(
    "first-parameter-load",
  );
  expect(screen.queryByRole("button", { name: "创建备份" })).toBeNull();
});

test.each(["account_auth_status", "app_setting_list"])(
  "failed_refresh_after_backup_uses_original_error_handling: %s",
  async (failedCommand) => {
    let finished = false;
    vi.mocked(appBackupExport).mockImplementation(async () => {
      finished = true;
      return { bytes: 256, sha256: "0".repeat(64) };
    });
    mockAppIpc((command) => {
      if (finished && command === failedCommand)
        return Promise.reject({
          code: "app.cache.unavailable",
          params: {},
          traceId: "refresh-after-backup",
        });
      if (command === "app_file_pick")
        return {
          token: "picked",
          fileName: "copy.tenon-backup.zip",
          format: null,
        };
      return undefined;
    });
    renderApp("/settings/data");
    fireEvent.click(await screen.findByRole("button", { name: "创建备份" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "继续并选择保存位置" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "refresh-after-backup",
    );
    expect(screen.queryByRole("button", { name: "创建备份" })).toBeNull();
  },
);
