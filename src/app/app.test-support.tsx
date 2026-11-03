import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach } from "vitest";
import {
  defaultSettings,
  paramEntries,
  queryWrapper,
} from "@/core/core.test-support";
import { toast } from "@/kit";
import type { AppSettings } from "@/lib/generated/AppSettings";
import { notifyParams } from "@/modules/notify/notify.test-support";
import "@/shell/shell.test-support";
import { Application, appRoutes } from "./bootstrap";
import { mockAppIpc as mockSettingsIpc } from "./settings/settings.test-support";

export function mockAppIpc(
  override?: Parameters<typeof mockSettingsIpc>[0],
  settings: Partial<AppSettings> = {},
) {
  return mockSettingsIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    switch (command) {
      case "app_file_ingress_list":
        return { pending: [], recent: [], issue: null, skippedDirectories: 0 };
      case "notify_unread_count":
        return 0;
      case "notify_list":
        return { items: [], total: 0, page: 1, pageSize: 5 };
      case "app_setting_list":
        return [
          ...paramEntries.filter((entry) => entry.moduleId !== "notify"),
          ...notifyParams,
        ];
      case "app_window_close":
      case "notify_mark_read":
      case "notify_mark_all_read":
        return null;
    }
  }, settings);
}

const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => {
  toast.dismiss();
  for (const router of routers) router.dispose();
  routers.length = 0;
});

export function renderApp(path = "/", settings: Partial<AppSettings> = {}) {
  const initial = { ...defaultSettings, ...settings };
  const { client } = queryWrapper();
  client.setQueryData(["app", "settings"], initial);
  const router = createMemoryRouter(appRoutes(initial, "windows"), {
    initialEntries: [path],
  });
  routers.push(router);
  return {
    ...render(<Application client={client} router={router} />),
    client,
    router,
  };
}
