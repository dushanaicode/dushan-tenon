import type { ModuleManifest } from "@/core/contracts/module";

export const accountManifest: ModuleManifest = {
  id: "account",
  basePath: "/account",
  devPages: [],
  nav: [],
  routes: [
    {
      path: "/account/profile",
      Component: () =>
        import("./profile-page").then((m) => ({ default: m.ProfilePage })),
    },
  ],
  settings: [
    {
      id: "security",
      labelKey: "account.settings.title",
      order: 40,
      Component: () =>
        import("./security-settings").then((m) => ({
          default: m.SecuritySettings,
        })),
    },
  ],
  headerWidgets: [],
  workbenchObjects: [],
  workbenchPanels: [],
  fileTargets: [],
};
