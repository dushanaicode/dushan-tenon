import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import {
  mockAppIpc,
  paramEntries,
  queryWrapper,
} from "@/core/core.test-support";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { ModuleDirectoryProvider } from "@/core/module-directory";
import { testManifest } from "@/core/module-directory.test-support";
import { SettingsDraftProvider } from "@/core/settings/drafts";
import { SettingsActionBar } from "@/core/settings/settings-action-bar";
import { Toaster } from "@/kit";
import { JOB_KINDS } from "@/lib/generated/job-kinds";
import type { NotificationItem } from "@/lib/generated/NotificationItem";
import { notifyManifest } from "./manifest";
import { NotificationBell, NotificationsPage } from "./notifications";
import { notifyParams } from "./notify.test-support";
import { NotifySettingsSection } from "./settings-section";
import { NotificationToasts } from "./toasts";

export const jobId = "01999000-1234-7000-8000-123456789abd";
export const item: NotificationItem = {
  id: "notification-1",
  category: "job",
  titleKey: "notify.job.failed.title",
  bodyKey: "notify.job.failed.body",
  params: {
    kind: { $t: `jobs.kinds.${JOB_KINDS[0]}` },
    error: { $t: "errors.app.input.invalid" },
    path: "payload",
  },
  jobId,
  readAt: null,
  createdAt: "2026-10-17T10:00:00.000Z",
};

export function mockNotifyIpc(
  override?: Parameters<typeof mockAppIpc>[0],
  settingsPatch: Parameters<typeof mockAppIpc>[1] = {},
) {
  return mockAppIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    switch (command) {
      case "notify_unread_count":
        return 0;
      case "notify_list":
        return { items: [], total: 0, page: 1, pageSize: 5 };
      case "notify_mark_read":
      case "notify_mark_all_read":
        return null;
      case "app_setting_list":
        return [
          ...paramEntries.filter((entry) => entry.moduleId !== "notify"),
          ...notifyParams,
        ];
    }
  }, settingsPatch);
}

export function renderNotify(
  path = "/",
  { toasts = false, registered = true } = {},
) {
  const { client } = queryWrapper();
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <NotificationBell />
            {toasts && <NotificationToasts />}
            <Outlet />
            <Toaster />
          </>
        ),
        children: [
          { path: "/", element: <h1>首页</h1> },
          { path: "/notify", element: <NotificationsPage /> },
          { path: "/devtools/jobs/:id", element: <h1>任务详情</h1> },
          {
            path: "/settings/notify",
            element: (
              <EditSessionsProvider>
                <SettingsDraftProvider>
                  <NotifySettingsSection />
                  <SettingsActionBar />
                </SettingsDraftProvider>
              </EditSessionsProvider>
            ),
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <ModuleDirectoryProvider
          manifests={
            registered ? [notifyManifest, testManifest()] : [notifyManifest]
          }
        >
          <RouterProvider router={router} />
        </ModuleDirectoryProvider>
      </QueryClientProvider>,
    ),
  };
}
