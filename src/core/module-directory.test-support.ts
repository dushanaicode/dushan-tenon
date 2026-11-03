import type { ModuleManifest } from "./contracts/module";

const Component = async () => ({ default: () => null });
export function testManifest(
  patch: Partial<ModuleManifest> = {},
): ModuleManifest {
  return {
    id: "devtools",
    basePath: "/devtools",
    nav: [],
    routes: [],
    settings: [],
    headerWidgets: [],
    devPages: [
      {
        path: "/devtools/jobs/:id",
        permission: "devtools.job.read",
        Component,
      },
    ],
    workbenchObjects: [
      {
        kind: "job",
        route: "/devtools/jobs/:id",
        resolve: async () => null,
        Component,
      },
    ],
    workbenchPanels: [],
    fileTargets: [],
    ...patch,
  };
}
