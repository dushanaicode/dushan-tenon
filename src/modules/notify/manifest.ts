import type { ModuleManifest } from "@/core/contracts/module";

export const notifyManifest: ModuleManifest = {
  id: "notify",
  basePath: "/notify",
  devPages: [],
  nav: [],
  routes: [
    {
      path: "/notify",
      Component: () =>
        import("./notifications").then((m) => ({
          default: m.NotificationsPage,
        })),
    },
  ],
  settings: [
    {
      id: "notify",
      labelKey: "notify.settings.title",
      order: 30,
      paramGroups: ["notify.preferences"],
      Component: () =>
        import("./settings-section").then((m) => ({
          default: m.NotifySettingsSection,
        })),
    },
  ],
  workbenchObjects: [],
  workbenchPanels: [],
  fileTargets: [],
  headerWidgets: [
    {
      id: "notify.bell",
      order: 10,
      Component: () =>
        import("./notifications").then((m) => ({
          default: m.NotificationBell,
        })),
    },
    {
      id: "notify.toasts",
      order: 20,
      Component: () =>
        import("./toasts").then((m) => ({
          default: m.NotificationToasts,
        })),
    },
  ],
};
