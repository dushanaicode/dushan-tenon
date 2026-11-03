import { act, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { defaultSettings } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import { toast } from "@/kit";
import { mockAppIpc } from "./app.test-support";
import { desktopPlatform, startApp } from "./bootstrap";

const roots: import("react-dom/client").Root[] = [];
const routers: ReturnType<typeof import("react-router").createHashRouter>[] =
  [];
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      roots.push(root);
      return root;
    },
  };
});
vi.mock("react-router", async (original) => {
  const actual = await original<typeof import("react-router")>();
  return {
    ...actual,
    createHashRouter: (...args: Parameters<typeof actual.createHashRouter>) => {
      const router = actual.createHashRouter(...args);
      routers.push(router);
      return router;
    },
  };
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  for (const router of routers) router.dispose();
  roots.length = 0;
  routers.length = 0;
  window.location.hash = "";
});

test.each([
  ["Win32", "windows"],
  ["MacIntel", "macos"],
  ["Linux x86_64", "linux"],
])("识别当前桌面平台 %s", (platform, expected) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  expect(desktopPlatform()).toBe(expected);
});

test("不把未知平台猜成 Windows", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("unknown");
  expect(desktopPlatform).toThrow("Unsupported desktop platform");
});

test("真实 hash 启动使用宿主语言和设置，StrictMode 不重复窗口有效订阅", async () => {
  const calls = mockAppIpc();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const settings = {
    ...defaultSettings,
    language: { value: "en-US" as const, source: "file" as const },
  };
  const changed = vi.spyOn(i18n, "changeLanguage");
  const root = document.createElement("div");
  document.body.append(root);
  window.location.hash = "#/settings/appearance";
  await act(async () => {
    await startApp(root, settings);
  });
  await screen.findByRole("combobox", {
    name: i18n.t("settings.appearance.colorMode"),
  });
  expect(document.documentElement.lang).toBe("en-US");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(routers).toHaveLength(1);
  expect(routers[0].state.location.pathname).toBe("/settings/appearance");
  expect(
    calls.mock.calls.some(([command]) => command === "app_settings_get"),
  ).toBe(false);
  act(() => {
    toast("bootstrap-toast");
  });
  await screen.findByText("bootstrap-toast");
  expect(root.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
  root.remove();
});
