import type { ModuleManifest } from "@/core/contracts/module";

export const devtoolsManifest: ModuleManifest = {
  fileTargets: [],
  id: "devtools",
  basePath: "/devtools",
  nav: [],
  routes: [],
  devPages: [
    {
      path: "/devtools/schedules",
      permission: "devtools.job.read",
      nav: {
        id: "devtools.schedules",
        labelKey: "schedules.title",
        order: 20,
        iconId: "schedules",
      },
      Component: () =>
        import("./schedules-page").then((m) => ({ default: m.SchedulesPage })),
    },
    {
      path: "/devtools/jobs",
      permission: "devtools.job.read",
      nav: {
        id: "devtools.jobs",
        labelKey: "jobs.title",
        order: 10,
        iconId: "jobs",
      },
      Component: () =>
        import("./jobs-page").then((m) => ({ default: m.JobsPage })),
    },
    {
      path: "/devtools/jobs/:id",
      permission: "devtools.job.read",
      Component: () =>
        import("./job-detail-page").then((m) => ({ default: m.JobDetailPage })),
    },
    {
      path: "/devtools/modules",
      nav: {
        id: "devtools.modules",
        labelKey: "devtools.modules.title",
        order: 30,
        iconId: "modules",
      },
      Component: () =>
        import("./modules-page").then((m) => ({ default: m.ModulesPage })),
    },
    {
      path: "/devtools/settings",
      nav: {
        id: "devtools.settings",
        labelKey: "devtools.settings.title",
        order: 40,
        iconId: "settings-inspect",
      },
      Component: () =>
        import("./settings-page").then((m) => ({ default: m.SettingsPage })),
    },
  ],
  settings: [],
  headerWidgets: [],
  workbenchPanels: [
    {
      id: "job-inspector",
      order: 10,
      labelKey: "shell.panels.jobInspector",
      iconId: "settings-inspect",
      objectKind: "job",
      developerOnly: true,
      permission: "devtools.job.read",
      Component: () =>
        import("./job-inspector").then((m) => ({ default: m.JobInspector })),
    },
  ],
  workbenchObjects: [
    {
      kind: "job",
      route: "/devtools/jobs/:id",
      resolve: (ref) =>
        import("./workbench-object").then((m) => m.resolveJob(ref)),
      Component: () =>
        import("./workbench-object").then((m) => ({
          default: m.WorkbenchJobObject,
        })),
    },
  ],
};
