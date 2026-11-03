import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { AppSettingsUpdate } from "@/lib/generated/AppSettingsUpdate";
import {
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "./app-settings";
import { getSnapshot } from "./appearance-bridge";
import { defaultSettings, mockAppIpc, queryWrapper } from "./core.test-support";
import { i18n } from "./i18n";

function useSettings() {
  return {
    query: useAppSettings(),
    update: useSettingsUpdate(),
    pending: useSettingsPending(),
  };
}
it("queries direct host settings and applies language and mode", async () => {
  mockAppIpc(undefined, {
    theme: { value: "dark", source: "file" },
    language: { value: "en-US", source: "file" },
  });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(useSettings, { wrapper });
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  expect(getSnapshot()).toEqual({ mode: "dark", dark: true });
  expect(i18n.language).toBe("en-US");
  expect(result.current.query.data?.theme.value).toBe("dark");
});
it("does not change saved mode or language after failed updates", async () => {
  mockAppIpc((command) => {
    if (command === "app_settings_update")
      throw {
        code: "app.config.overridden",
        params: {},
        traceId: "settings-update",
      };
  });
  const { wrapper, client } = queryWrapper();
  const { result } = renderHook(useSettings, { wrapper });
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  const previous = getSnapshot();
  await act(async () => {
    result.current.update.mutate({ theme: "dark", language: "en-US" });
  });
  await waitFor(() => expect(result.current.update.isError).toBe(true));
  expect(result.current.update.error?.traceId).toBe("settings-update");
  expect(getSnapshot()).toBe(previous);
  expect(i18n.language).toBe("zh-CN");
  expect(
    client.getQueryData<AppSettings>(["app", "settings"])?.theme.value,
  ).toBe("system");
});
it("serializes writes and applies authoritative responses only after acknowledgement", async () => {
  const writes: AppSettingsUpdate[] = [];
  let complete!: (settings: AppSettings) => void;
  mockAppIpc((command, payload) => {
    if (command !== "app_settings_update") return;
    const { input } = payload as { input: AppSettingsUpdate };
    writes.push(input);
    if (writes.length === 1)
      return new Promise((resolve) => {
        complete = resolve;
      });
    return { ...defaultSettings, theme: { value: "light", source: "file" } };
  });
  const { wrapper, client } = queryWrapper();
  client.setQueryData(["app", "about"], {});
  const { result } = renderHook(useSettings, { wrapper });
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  act(() => {
    result.current.update.mutate({ theme: "dark" });
    result.current.update.mutate({ theme: "system" });
  });
  await waitFor(() => expect(result.current.pending).toBe(true));
  expect(writes).toEqual([{ theme: "dark" }]);
  expect(getSnapshot().mode).toBe("system");
  await act(() =>
    complete({ ...defaultSettings, theme: { value: "dark", source: "file" } }),
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(writes).toEqual([{ theme: "dark" }, { theme: "system" }]);
  expect(getSnapshot().mode).toBe("light");
  expect(
    client.getQueryData<AppSettings>(["app", "settings"])?.theme.value,
  ).toBe("light");
  expect(client.getQueryState(["app", "about"])?.isInvalidated).toBe(true);
});
