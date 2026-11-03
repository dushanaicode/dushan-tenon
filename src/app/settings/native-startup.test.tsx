import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { i18n } from "@/core/i18n";
import type { NativeSettings as NativeSettingsDto } from "@/lib/generated/NativeSettings";
import {
  defaultNativeSettings,
  mockAppIpc,
  renderNative,
} from "./settings.test-support";

test("更新状态未配置时覆盖原生设置中陈旧的 configured，启动检查不能开启", async () => {
  const calls = mockAppIpc((name) =>
    name === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          updater: {
            configured: true,
            checkOnStart: { value: true, source: "file" },
          },
        }
      : undefined,
  );
  renderNative();
  const toggle = await screen.findByRole("switch", {
    name: i18n.t("settings.update.checkOnStart"),
  });
  expect(toggle).toHaveProperty("disabled", true);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle);
  expect(
    calls.mock.calls.some(([name]) => name === "app_native_settings_update"),
  ).toBe(false);
  expect(calls.mock.calls.some(([name]) => name === "app_update_status")).toBe(
    true,
  );
});

test("macOS advertises a Command shortcut example", async () => {
  mockAppIpc();
  renderNative("macos");
  expect(await screen.findByPlaceholderText("Cmd+Shift+K")).toBeTruthy();
});

test("unsupported system shortcuts are read-only without affecting application shortcuts", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          shortcut: { ...defaultNativeSettings.shortcut, state: "unsupported" },
        }
      : undefined,
  );
  renderNative();
  const input = await screen.findByRole("textbox", {
    name: i18n.t("settings.shortcut.label"),
  });
  expect(input).toHaveProperty("disabled", true);
  const save = screen.getByRole("button", {
    name: i18n.t("settings.shortcut.save"),
  });
  expect(save).toHaveProperty("disabled", true);
  fireEvent.click(save);
  expect(
    calls.mock.calls.some(
      ([command]) => command === "app_native_settings_update",
    ),
  ).toBe(false);
});

test("unconfigured_startup_check_is_disabled", async () => {
  const calls = mockAppIpc();
  renderNative();
  const toggle = await screen.findByRole("switch", {
    name: i18n.t("settings.update.checkOnStart"),
  });
  expect(toggle).toHaveProperty("disabled", true);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText(i18n.t("settings.update.unconfigured"))).toBeTruthy();
  fireEvent.click(toggle);
  expect(
    calls.mock.calls.some(
      ([command]) => command === "app_native_settings_update",
    ),
  ).toBe(false);
});

test("ordinary_active_identity_is_read_only", async () => {
  mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? { ...defaultNativeSettings, canEdit: false }
      : undefined,
  );
  renderNative();
  for (const toggle of await screen.findAllByRole("switch")) {
    expect(toggle).toHaveProperty("disabled", true);
  }
  expect(
    screen.getByRole("button", { name: i18n.t("settings.window.reset") }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getAllByText(i18n.t("settings.native.ownerOnly")).length,
  ).toBeGreaterThan(0);
});

test.each([
  "development",
  "explicitStateRoot",
  "notInstalled",
  "unsupportedPlatform",
] as const)("unsupported_scope_%s_has_no_autostart_switch", async (reason) => {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          autostart: {
            ...defaultNativeSettings.autostart,
            registered: { status: "unsupported", reason },
          },
        }
      : undefined,
  );
  renderNative();
  expect(
    await screen.findByText(i18n.t(`settings.autostart.unsupported.${reason}`)),
  ).toBeTruthy();
  expect(
    screen.queryByRole("switch", {
      name: i18n.t("settings.autostart.registered"),
    }),
  ).toBeNull();
  expect(
    calls.mock.calls.filter(
      ([command]) => command === "app_native_settings_get",
    ),
  ).toHaveLength(1);
});

test("autostart_displays_system_registration_instead_of_intent", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          autostart: {
            ...defaultNativeSettings.autostart,
            registered: { status: "known", value: true },
            state: "ready",
          },
        }
      : undefined,
  );
  renderNative();
  const toggle = await screen.findByRole("switch", {
    name: i18n.t("settings.autostart.registered"),
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(
    screen.getByText(i18n.t("settings.autostart.policyDescription")),
  ).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(toggle.getAttribute("aria-checked")).toBe("false"),
  );
  expect(calls).toHaveBeenCalledWith("app_native_settings_update", {
    input: { type: "autostart", enabled: false },
  });
});

test("unknown_registration_is_not_false", async () => {
  mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          autostart: {
            ...defaultNativeSettings.autostart,
            registered: {
              status: "unknown",
              error: {
                code: "app.native.unavailable",
                params: {},
                traceId: "unknown-registration",
              },
            },
            state: "unavailable",
          },
        }
      : undefined,
  );
  renderNative();
  expect(await screen.findByText(/unknown-registration/)).toBeTruthy();
  expect(
    screen.queryByRole("switch", {
      name: i18n.t("settings.autostart.registered"),
    }),
  ).toBeNull();
  expect(
    screen.getByText(
      `${i18n.t("settings.native.systemState")}: ${i18n.t("settings.native.unknown")}`,
    ),
  ).toBeTruthy();
});

test.each(["environment", "commandLine"] as const)(
  "%s_native_sources_disable_writes",
  async (source) => {
    const calls = mockAppIpc((command) =>
      command === "app_native_settings_get"
        ? {
            ...defaultNativeSettings,
            autostart: {
              ...defaultNativeSettings.autostart,
              desired: { value: false, source },
              registered: { status: "known", value: false },
              state: "ready",
            },
            shortcut: {
              ...defaultNativeSettings.shortcut,
              desired: { value: "Ctrl+Alt+D", source },
            },
          }
        : undefined,
    );
    renderNative();
    const toggle = await screen.findByRole("switch", {
      name: i18n.t("settings.autostart.registered"),
    });
    expect(toggle).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("textbox", { name: i18n.t("settings.shortcut.label") }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: i18n.t("settings.shortcut.save") }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(toggle);
    expect(
      calls.mock.calls.some(
        ([command]) => command === "app_native_settings_update",
      ),
    ).toBe(false);
  },
);

test("shortcut_failure_refreshes_actual_holdings_and_preserves_draft", async () => {
  let snapshot = structuredClone(defaultNativeSettings);
  let rejectUpdate: (reason: unknown) => void;
  const pending = new Promise<NativeSettingsDto>((_resolve, reject) => {
    rejectUpdate = reject;
  });
  const calls = mockAppIpc((command) => {
    if (command === "app_native_settings_get") return snapshot;
    if (command === "app_native_settings_update") return pending;
    return undefined;
  });
  renderNative();
  const input = await screen.findByRole("textbox", {
    name: i18n.t("settings.shortcut.label"),
  });
  fireEvent.change(input, { target: { value: "Ctrl+Alt+E" } });
  const save = screen.getByRole("button", {
    name: i18n.t("settings.shortcut.save"),
  });
  fireEvent.click(save);
  await waitFor(() => expect(save).toHaveProperty("disabled", true));
  snapshot = {
    ...snapshot,
    shortcut: {
      ...snapshot.shortcut,
      state: "degraded",
      registered: ["control+alt+KeyE"],
      error: {
        code: "app.native.compensation_failed",
        params: {
          operation: "app.native.unavailable",
          compensation: "app.native.unavailable",
        },
        traceId: "read-back",
      },
    },
  };
  await act(async () =>
    rejectUpdate({
      code: "app.native.compensation_failed",
      params: {
        operation: "app.native.unavailable",
        compensation: "app.native.unavailable",
      },
      traceId: "save-failed",
    }),
  );
  expect(
    await screen.findByText(i18n.t("settings.shortcut.degraded")),
  ).toBeTruthy();
  expect(screen.getByText("control+alt+KeyE")).toBeTruthy();
  expect(input).toHaveProperty("value", "Ctrl+Alt+E");
  expect(
    calls.mock.calls.filter(
      ([command]) => command === "app_native_settings_get",
    ),
  ).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: i18n.t("settings.native.retry") }),
  ).toBeTruthy();
});

test("shortcut_save_and_clear_use_host_snapshot", async () => {
  const calls = mockAppIpc();
  renderNative();
  const input = await screen.findByRole("textbox", {
    name: i18n.t("settings.shortcut.label"),
  });
  fireEvent.change(input, { target: { value: "Ctrl+Alt+E" } });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.shortcut.save") }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: i18n.t("settings.shortcut.save") }),
    ).toHaveProperty("disabled", true),
  );
  expect(calls).toHaveBeenCalledWith("app_native_settings_update", {
    input: { type: "shortcut", binding: "Ctrl+Alt+E" },
  });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.shortcut.save") }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: i18n.t("settings.shortcut.save") }),
    ).toHaveProperty("disabled", true),
  );
  expect(calls).toHaveBeenCalledWith("app_native_settings_update", {
    input: { type: "shortcut", binding: "" },
  });
  expect(screen.queryByText("Ctrl+Alt+E")).toBeNull();
});

test("saved_unavailable_shortcut_has_explicit_retry", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          shortcut: {
            ...defaultNativeSettings.shortcut,
            desired: { value: "Ctrl+Alt+D", source: "file" },
            state: "unavailable",
            error: {
              code: "app.shortcut.conflict",
              params: {},
              traceId: "startup-conflict",
            },
          },
        }
      : undefined,
  );
  renderNative();
  fireEvent.click(
    await screen.findByRole("button", {
      name: i18n.t("settings.native.retry"),
    }),
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_native_settings_update", {
      input: { type: "shortcut", binding: "Ctrl+Alt+D" },
    }),
  );
});

test("autostart_failed_save_rereads_system_and_keeps_saved_intent", async () => {
  let snapshot: NativeSettingsDto = {
    ...structuredClone(defaultNativeSettings),
    autostart: {
      ...defaultNativeSettings.autostart,
      registered: { status: "known", value: false },
      state: "ready",
    },
  };
  const calls = mockAppIpc((command) => {
    if (command === "app_native_settings_get") return snapshot;
    if (command === "app_native_settings_update") {
      snapshot = {
        ...snapshot,
        autostart: {
          ...snapshot.autostart,
          registered: { status: "known", value: true },
          state: "degraded",
        },
      };
      return Promise.reject({
        code: "app.native.compensation_failed",
        params: {
          operation: "app.native.unavailable",
          compensation: "app.native.unavailable",
        },
        traceId: "autostart-save-failed",
      });
    }
    return undefined;
  });
  renderNative();
  const toggle = await screen.findByRole("switch", {
    name: i18n.t("settings.autostart.registered"),
  });
  fireEvent.click(toggle);
  expect(
    await screen.findByText(i18n.t("settings.autostart.degraded")),
  ).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(
    screen.getByText(
      `${i18n.t("settings.native.desiredState")}: ${i18n.t("settings.native.disabled")}`,
      { exact: false },
    ),
  ).toBeTruthy();
  expect(
    calls.mock.calls.filter(
      ([command]) => command === "app_native_settings_get",
    ),
  ).toHaveLength(2);
});

test("native_state_only_probes_on_mount_refresh_or_save", async () => {
  const calls = mockAppIpc();
  renderNative();
  const refresh = await screen.findByRole("button", {
    name: i18n.t("settings.native.refresh"),
  });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  expect(
    calls.mock.calls.filter(
      ([command]) => command === "app_native_settings_get",
    ),
  ).toHaveLength(1);
  fireEvent.click(refresh);
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(
        ([command]) => command === "app_native_settings_get",
      ),
    ).toHaveLength(2),
  );
});

test("non_owner_cannot_write_system_settings", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          canEdit: false,
          autostart: {
            ...defaultNativeSettings.autostart,
            registered: { status: "known", value: false },
            state: "ready",
          },
        }
      : undefined,
  );
  renderNative();
  const toggle = await screen.findByRole("switch", {
    name: i18n.t("settings.autostart.registered"),
  });
  expect(toggle).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("textbox", { name: i18n.t("settings.shortcut.label") }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(toggle);
  expect(
    calls.mock.calls.some(
      ([command]) => command === "app_native_settings_update",
    ),
  ).toBe(false);
});

test.each([
  { approval: "allowed", effective: "enabled" },
  { approval: "disabled", effective: "disabled" },
  { approval: "unknown", effective: "unknown" },
] as const)(
  "approval_$approval_is_separate_from_registration",
  async ({ approval, effective }) => {
    mockAppIpc((command) =>
      command === "app_native_settings_get"
        ? {
            ...defaultNativeSettings,
            autostart: {
              ...defaultNativeSettings.autostart,
              registered: { status: "known", value: true },
              approval,
              effectiveStartup: effective,
              state: "ready",
            },
          }
        : undefined,
    );
    renderNative();
    const toggle = await screen.findByRole("switch", {
      name: i18n.t("settings.autostart.registered"),
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText(
        `${i18n.t("settings.autostart.approval")}: ${i18n.t(`settings.autostart.approval.${approval}`)}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `${i18n.t("settings.autostart.effective")}: ${i18n.t(`settings.autostart.effective.${effective}`)}`,
      ),
    ).toBeTruthy();
  },
);

test("approval_read_failure_keeps_registration_fact", async () => {
  mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          autostart: {
            ...defaultNativeSettings.autostart,
            registered: { status: "known", value: true },
            approval: "unknown",
            approvalError: {
              code: "app.native.unavailable",
              params: {},
              traceId: "approval-read-failed",
            },
            state: "unavailable",
          },
        }
      : undefined,
  );
  renderNative();
  expect(await screen.findByText(/approval-read-failed/)).toBeTruthy();
  expect(
    screen
      .getByRole("switch", { name: i18n.t("settings.autostart.registered") })
      .getAttribute("aria-checked"),
  ).toBe("true");
});
