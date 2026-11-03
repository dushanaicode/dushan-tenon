import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { i18n } from "@/core/i18n";
import type { NativeSettings as NativeSettingsDto } from "@/lib/generated/NativeSettings";
import {
  defaultNativeSettings,
  mockAppIpc,
  renderApp,
  renderNative,
} from "./settings.test-support";

test.each(["environment", "commandLine"] as const)(
  "window_controls_use_saved_fact: %s override",
  async (source) => {
    const calls = mockAppIpc((command) =>
      command === "app_native_settings_get"
        ? {
            ...defaultNativeSettings,
            window: {
              ...defaultNativeSettings.window,
              restoreState: { value: false, source },
              state: "disabled",
            },
          }
        : undefined,
    );
    renderNative();
    const toggle = await screen.findByRole("switch", {
      name: i18n.t("settings.window.restore"),
    });
    expect(toggle).toHaveProperty("disabled", true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(i18n.t(`settings.source.${source}`))).toBeTruthy();
    fireEvent.click(toggle);
    expect(
      calls.mock.calls.some(
        ([command]) => command === "app_native_settings_update",
      ),
    ).toBe(false);
  },
);

test("window_controls_use_saved_fact: failure retains saved value", async () => {
  let rejectUpdate: (error: unknown) => void;
  const pending = new Promise<NativeSettingsDto>((_resolve, reject) => {
    rejectUpdate = reject;
  });
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_update" ? pending : undefined,
  );
  renderNative();
  const toggle = await screen.findByRole("switch", {
    name: i18n.t("settings.window.restore"),
  });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveProperty("disabled", true));
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(calls).toHaveBeenCalledWith("app_native_settings_update", {
    input: { type: "window", restoreState: false },
  });
  await act(async () =>
    rejectUpdate({
      code: "app.native.unavailable",
      params: {},
      traceId: "save-failed",
    }),
  );
  expect(await screen.findByText(/save-failed/)).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
});

test("window_controls_use_saved_fact: successful toggle consumes host snapshot", async () => {
  mockAppIpc();
  renderNative();
  const toggle = await screen.findByRole("switch", {
    name: i18n.t("settings.window.restore"),
  });
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(toggle.getAttribute("aria-checked")).toBe("false"),
  );
  expect(
    screen.getByText(i18n.t("settings.window.state.disabled")),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: i18n.t("settings.window.reset") }),
  ).toHaveProperty("disabled", true);
});

test("reset_only_changes_geometry_and_displays_corrupt_record", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_native_settings_get"
      ? {
          ...defaultNativeSettings,
          window: {
            ...defaultNativeSettings.window,
            state: "failed",
            error: {
              code: "app.window_state.invalid",
              params: {},
              traceId: "corrupt",
            },
          },
        }
      : undefined,
  );
  renderApp("/settings/general");
  expect(await screen.findByText(/corrupt/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.window.reset") }),
  );
  await screen.findByText(i18n.t("settings.window.state.restored"));
  expect(calls).toHaveBeenCalledWith("app_window_state_reset", {});
  expect(
    calls.mock.calls.some(
      ([command]) =>
        command === "app_settings_update" ||
        command === "app_native_settings_update",
    ),
  ).toBe(false);
  expect(screen.queryByText(/corrupt/)).toBeNull();
});
