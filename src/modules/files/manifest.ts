import type { ModuleManifest } from "@/core/contracts/module";

export const filesManifest: ModuleManifest = {
  fileTargets: [
    {
      id: "files.add",
      labelKey: "files.title",
      path: "/files",
      purpose: "store",
      extensions: [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "pdf",
        "xlsx",
        "txt",
        "md",
        "csv",
        "json",
      ],
      developerOnly: true,
      permission: "files.file.write",
    },
  ],
  id: "files",
  basePath: "/files",
  nav: [],
  routes: [],
  devPages: [
    {
      path: "/files",
      permission: "files.file.read",
      nav: {
        id: "files.title",
        labelKey: "files.title",
        order: 50,
        iconId: "files",
      },
      Component: () =>
        import("./files-page").then((m) => ({ default: m.FilesPage })),
    },
  ],
  settings: [],
  headerWidgets: [],
  workbenchObjects: [],
  workbenchPanels: [],
};
