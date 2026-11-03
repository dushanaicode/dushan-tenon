import { createContext, type ReactNode, useContext } from "react";
import { matchPath } from "react-router";
import type { ModuleManifest, ModuleRoute } from "./contracts/module";

const Directory = createContext<readonly ModuleManifest[] | null>(null);

export function ModuleDirectoryProvider({
  manifests,
  children,
}: {
  manifests: readonly ModuleManifest[];
  children: ReactNode;
}) {
  return <Directory.Provider value={manifests}>{children}</Directory.Provider>;
}

export function useModuleDirectory() {
  const directory = useContext(Directory);
  if (!directory) throw new Error("ModuleDirectoryProvider is required");
  return directory;
}

export function moduleOfPath(
  manifests: readonly ModuleManifest[],
  path: string,
) {
  return manifests.find(
    ({ basePath }) => path === basePath || path.startsWith(`${basePath}/`),
  );
}

export function moduleRoutes(manifest: ModuleManifest): ModuleRoute[] {
  return [
    ...manifest.routes,
    ...manifest.devPages.map((page) => ({
      ...page,
      developerOnly: true as const,
    })),
  ];
}

export function routeOfPath(manifest: ModuleManifest, path: string) {
  return moduleRoutes(manifest).find((route) =>
    matchPath({ path: route.path, caseSensitive: true, end: true }, path),
  );
}
