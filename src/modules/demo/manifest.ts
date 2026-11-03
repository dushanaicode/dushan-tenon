import type { ModuleManifest } from "@/core/contracts/module";

export const demoManifest: ModuleManifest = {
  fileTargets: [
    {
      id: "demo.sample-import",
      labelKey: "demo.sampleList",
      path: "/demo/samples",
      purpose: "import",
      extensions: ["csv", "xlsx", "json"],
      developerOnly: true,
      permission: "demo.sample.write",
      anyPermissions: ["demo.sample.import"],
    },
  ],
  id: "demo",
  basePath: "/demo",
  nav: [],
  routes: [],
  devNavParents: [
    {
      id: "demo.showcase",
      labelKey: "demo.showcase.title",
      iconId: "modules",
      order: 60,
    },
  ],
  devPages: [
    {
      path: "/demo",
      developerOnly: true,
      permission: "demo.sample.read",
      nav: {
        id: "demo.overview",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.start",
        labelKey: "demo.overview",
        order: 10,
        iconId: "modules",
      },
      Component: () =>
        import("./showcase/pages/overview-page").then((m) => ({
          default: m.OverviewPage,
        })),
    },
    {
      path: "/demo/catalog",
      developerOnly: true,
      nav: {
        id: "demo.catalog",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.start",
        labelKey: "demo.showcase.page.catalog",
        order: 20,
        iconId: "modules",
      },
      Component: () =>
        import("./showcase/pages/catalog-page").then((m) => ({
          default: m.CatalogPage,
        })),
    },
    {
      path: "/demo/navigation",
      developerOnly: true,
      nav: {
        id: "demo.navigation",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.navigation",
        labelKey: "demo.showcase.page.navigation",
        order: 30,
        iconId: "modules",
      },
      Component: () =>
        import("./showcase/pages/navigation-page").then((m) => ({
          default: m.NavigationPage,
        })),
    },
    {
      path: "/demo/menus",
      developerOnly: true,
      nav: {
        id: "demo.menus",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.navigation",
        labelKey: "demo.showcase.page.menus",
        order: 40,
        iconId: "menu",
      },
      Component: () =>
        import("./showcase/pages/menus-page").then((m) => ({
          default: m.MenusPage,
        })),
    },
    {
      path: "/demo/buttons",
      developerOnly: true,
      nav: {
        id: "demo.buttons",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.controls",
        labelKey: "demo.showcase.buttons",
        order: 50,
        iconId: "modules",
      },
      Component: () =>
        import("./showcase/pages/buttons-page").then((m) => ({
          default: m.ButtonsPage,
        })),
    },
    {
      path: "/demo/choices",
      developerOnly: true,
      nav: {
        id: "demo.choices",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.controls",
        labelKey: "demo.showcase.page.choices",
        order: 60,
        iconId: "selected",
      },
      Component: () =>
        import("./showcase/pages/choices-page").then((m) => ({
          default: m.ChoicesPage,
        })),
    },
    {
      path: "/demo/inputs",
      developerOnly: true,
      nav: {
        id: "demo.inputs",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.controls",
        labelKey: "demo.showcase.page.inputs",
        order: 70,
        iconId: "settings-inspect",
      },
      Component: () =>
        import("./showcase/pages/inputs-page").then((m) => ({
          default: m.InputsPage,
        })),
    },
    {
      path: "/demo/selects",
      developerOnly: true,
      nav: {
        id: "demo.selects",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.controls",
        labelKey: "demo.showcase.page.selects",
        order: 80,
        iconId: "selected",
      },
      Component: () =>
        import("./showcase/pages/selects-page").then((m) => ({
          default: m.SelectsPage,
        })),
    },
    {
      path: "/demo/overlays",
      developerOnly: true,
      nav: {
        id: "demo.overlays",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.overlays",
        labelKey: "demo.showcase.page.overlays",
        order: 90,
        iconId: "modules",
      },
      Component: () =>
        import("./showcase/pages/overlays-page").then((m) => ({
          default: m.OverlaysPage,
        })),
    },
    {
      path: "/demo/feedback",
      developerOnly: true,
      nav: {
        id: "demo.feedback",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.overlays",
        labelKey: "demo.showcase.page.feedback",
        order: 100,
        iconId: "info",
      },
      Component: () =>
        import("./showcase/pages/feedback-page").then((m) => ({
          default: m.FeedbackPage,
        })),
    },
    {
      path: "/demo/tables",
      developerOnly: true,
      nav: {
        id: "demo.tables",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.data",
        labelKey: "demo.showcase.page.tables",
        order: 110,
        iconId: "files",
      },
      Component: () =>
        import("./showcase/pages/tables-page").then((m) => ({
          default: m.TablesPage,
        })),
    },
    {
      path: "/demo/display",
      developerOnly: true,
      nav: {
        id: "demo.display",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.data",
        labelKey: "demo.showcase.page.display",
        order: 120,
        iconId: "info",
      },
      Component: () =>
        import("./showcase/pages/display-page").then((m) => ({
          default: m.DisplayPage,
        })),
    },
    {
      path: "/demo/templates",
      developerOnly: true,
      nav: {
        id: "demo.templates",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.templates",
        labelKey: "demo.showcase.page.templates",
        order: 130,
        iconId: "modules",
      },
      Component: () =>
        import("./showcase/pages/templates-page").then((m) => ({
          default: m.TemplatesPage,
        })),
    },
    {
      path: "/demo/samples",
      developerOnly: true,
      permission: "demo.sample.read",
      nav: {
        id: "demo.samples",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.samples",
        labelKey: "demo.showcase.dictionary",
        order: 140,
        iconId: "files",
      },
      Component: () =>
        import("./showcase/guides/samples-guide").then((m) => ({
          default: m.SamplesGuide,
        })),
    },
    {
      path: "/demo/measure",
      developerOnly: true,
      permission: "demo.sample.read",
      anyPermissions: ["demo.sample.run"],
      nav: {
        id: "demo.measure",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.samples",
        labelKey: "demo.showcase.tasks",
        order: 150,
        iconId: "jobs",
      },
      Component: () =>
        import("./showcase/guides/measure-guide").then((m) => ({
          default: m.MeasureGuide,
        })),
    },
    {
      path: "/demo/appearance",
      developerOnly: true,
      nav: {
        id: "demo.appearance",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.appearance",
        labelKey: "demo.showcase.page.appearance",
        order: 160,
        iconId: "theme-light",
      },
      Component: () =>
        import("./showcase/pages/appearance-page").then((m) => ({
          default: m.AppearancePage,
        })),
    },
    {
      path: "/demo/appearance-behavior",
      developerOnly: true,
      nav: {
        id: "demo.appearance-behavior",
        parentId: "demo.showcase",
        sectionLabelKey: "demo.showcase.appearance",
        labelKey: "demo.showcase.page.appearance-behavior",
        order: 170,
        iconId: "settings-inspect",
      },
      Component: () =>
        import("./showcase/pages/appearance-behavior-page").then((m) => ({
          default: m.AppearanceBehaviorPage,
        })),
    },
    {
      path: "/demo/samples/:id",
      developerOnly: true,
      permission: "demo.sample.read",
      Component: () => import("./sample-detail"),
    },
    {
      path: "/demo/jobs/:id",
      developerOnly: true,
      permission: "demo.sample.read",
      Component: () => import("./job-page"),
    },
  ],
  settings: [
    {
      id: "demo",
      labelKey: "demo.settings",
      order: 85,
      developerOnly: true,
      permission: "demo.settings.manage",
      paramGroups: ["demo.work"],
      Component: () => import("./settings-section"),
    },
  ],
  headerWidgets: [],
  workbenchObjects: [],
  workbenchPanels: [],
};
