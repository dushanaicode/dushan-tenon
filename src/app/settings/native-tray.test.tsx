import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { i18n } from "@/core/i18n";
import type { NativeSettings as NativeSettingsDto } from "@/lib/generated/NativeSettings";
import {
  defaultNativeSettings,
  mockAppIpc,
  renderNative,
} from "./settings.test-support";

test("tray_settings_show_unavailable", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          tray: {
            enabled: { value: true, source: "file" },
            closeAction: { value: "tray", source: "file" },
            state: "unavailable",
            error: {
              code: "app.native.unavailable",
              params: {},
              traceId: "tray-create-failed",
            },
          },
        }
      : undefined,
  );
  renderNative();
  const enabled = await screen.findByRole("switch", {
    name: i18n.t("settings.tray.enabled"),
  });
  expect(enabled.getAttribute("aria-checked")).toBe("true");
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("settings.window.closeAction"),
    }).textContent,
  ).toBe(i18n.t("settings.window.close.tray"));
  expect(
    screen.getByText(i18n.t("settings.tray.state.unavailable")),
  ).toBeTruthy();
  expect(screen.getByText(/tray-create-failed/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.tray.retry") }),
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_native_settings_update", {
      input: { type: "tray", enabled: true, closeAction: "tray" },
    }),
  );
});

test.each(["environment", "commandLine"] as const)(
  "tray_%s_override_is_read_only",
  async (source) => {
    mockAppIpc((command) =>
      command === "app_native_settings_get"
        ? {
            ...defaultNativeSettings,
            tray: {
              enabled: { value: true, source: "file" },
              closeAction: { value: "exit", source },
              state: "ready",
              error: null,
            },
          }
        : undefined,
    );
    renderNative();
    expect(
      await screen.findByRole("switch", {
        name: i18n.t("settings.tray.enabled"),
      }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("combobox", {
        name: i18n.t("settings.window.closeAction"),
      }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getAllByText(i18n.t(`settings.source.${source}`)).length,
    ).toBeGreaterThan(0);
  },
);

test("tray_unsupported_and_non_owner_cannot_write", async () => {
  mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          tray: {
            ...defaultNativeSettings.tray,
            error: {
              code: "app.native.unsupported_scope",
              params: {},
              traceId: "tray-unsupported",
            },
          },
        }
      : undefined,
  );
  renderNative();
  expect(await screen.findByText(/tray-unsupported/)).toBeTruthy();
  expect(
    screen.getByRole("switch", { name: i18n.t("settings.tray.enabled") }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("settings.window.closeAction"),
    }),
  ).toHaveProperty("disabled", true);
});

test("tray_switches_save_together_and_only_adopt_host_facts", async () => {
  const calls = mockAppIpc();
  renderNative();
  const enabled = await screen.findByRole("switch", {
    name: i18n.t("settings.tray.enabled"),
  });
  const close = screen.getByRole("combobox", {
    name: i18n.t("settings.window.closeAction"),
  });
  expect(close).toHaveProperty("disabled", false);
  fireEvent.click(enabled);
  await waitFor(() =>
    expect(enabled.getAttribute("aria-checked")).toBe("true"),
  );
  fireEvent.pointerDown(close, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(
    await screen.findByRole("option", {
      name: i18n.t("settings.window.close.tray"),
    }),
  );
  await waitFor(() =>
    expect(close.textContent).toBe(i18n.t("settings.window.close.tray")),
  );
  fireEvent.click(enabled);
  await waitFor(() =>
    expect(enabled.getAttribute("aria-checked")).toBe("false"),
  );
  expect(close.textContent).toBe(i18n.t("settings.window.close.exit"));
  expect(calls).toHaveBeenLastCalledWith("app_native_settings_update", {
    input: { type: "tray", enabled: false, closeAction: "exit" },
  });
});

test("tray_pending_failure_preserves_saved_values_and_refreshes", async () => {
  let rejectUpdate: (reason: unknown) => void;
  const pending = new Promise<NativeSettingsDto>((_resolve, reject) => {
    rejectUpdate = reject;
  });
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_update" ? pending : undefined,
  );
  renderNative();
  const enabled = await screen.findByRole("switch", {
    name: i18n.t("settings.tray.enabled"),
  });
  fireEvent.click(enabled);
  await waitFor(() => expect(enabled).toHaveProperty("disabled", true));
  expect(enabled.getAttribute("aria-checked")).toBe("false");
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("settings.window.closeAction"),
    }),
  ).toHaveProperty("disabled", true);
  await act(async () =>
    rejectUpdate({
      code: "app.native.unavailable",
      params: {},
      traceId: "tray-update-failed",
    }),
  );
  expect(await screen.findByText(/tray-update-failed/)).toBeTruthy();
  expect(enabled.getAttribute("aria-checked")).toBe("false");
  expect(
    calls.mock.calls.filter(
      ([command]) => command === "app_native_settings_get",
    ),
  ).toHaveLength(2);
});

test("close_action_allows_ask_without_tray_and_disables_unavailable_tray_choice", async () => {
  const calls = mockAppIpc();
  renderNative();
  const close = await screen.findByRole("combobox", {
    name: i18n.t("settings.window.closeAction"),
  });
  fireEvent.pointerDown(close, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  expect(
    (
      await screen.findByRole("option", {
        name: i18n.t("settings.window.close.tray"),
      })
    ).getAttribute("aria-disabled"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("option", { name: i18n.t("settings.window.close.ask") }),
  );
  await waitFor(() =>
    expect(close.textContent).toBe(i18n.t("settings.window.close.ask")),
  );
  expect(calls).toHaveBeenLastCalledWith("app_native_settings_update", {
    input: { type: "tray", enabled: false, closeAction: "ask" },
  });
  const enabled = screen.getByRole("switch", {
    name: i18n.t("settings.tray.enabled"),
  });
  fireEvent.click(enabled);
  await waitFor(() =>
    expect(enabled.getAttribute("aria-checked")).toBe("true"),
  );
  fireEvent.click(enabled);
  await waitFor(() =>
    expect(enabled.getAttribute("aria-checked")).toBe("false"),
  );
  expect(calls).toHaveBeenLastCalledWith("app_native_settings_update", {
    input: { type: "tray", enabled: false, closeAction: "ask" },
  });
});
