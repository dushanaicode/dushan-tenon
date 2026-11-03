import { queryOptions, useQuery } from "@tanstack/react-query";
import type { AppModules } from "@/lib/generated/AppModules";
import { appModulesList } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import { useAppSettings } from "./app-settings";
import { useAuthStatus } from "./auth";
import type { ModuleManifest } from "./contracts/module";
import {
  moduleOfPath,
  routeOfPath,
  useModuleDirectory,
} from "./module-directory";
import { evaluateVisibility, type VisibilityAuth } from "./visibility";

export const appModulesQuery = queryOptions<AppModules, IpcError>({
  queryKey: ["app", "modules"],
  queryFn: appModulesList,
  staleTime: Infinity,
  retry: false,
});

export function useEnabledModules(): {
  isPending: boolean;
  error: IpcError | null;
  enabled: ReadonlySet<string> | undefined;
} {
  const modules = useQuery(appModulesQuery);
  return {
    isPending: modules.isPending,
    error: modules.error,
    enabled: modules.isSuccess
      ? new Set(
          modules.data.modules
            .filter((module) => module.enabled)
            .map((module) => module.id),
        )
      : undefined,
  };
}

export function canOpenPath(
  manifests: readonly ModuleManifest[],
  enabled: ReadonlySet<string> | undefined,
  auth: VisibilityAuth | undefined,
  path: string,
): boolean {
  const manifest = moduleOfPath(manifests, path);
  if (!manifest) return path === "/" || path === "/settings";
  const route = routeOfPath(manifest, path);
  return Boolean(
    enabled?.has(manifest.id) &&
      route &&
      auth &&
      evaluateVisibility(route, auth) === "visible",
  );
}

export function useCanOpen(path: string): boolean {
  const manifests = useModuleDirectory();
  const { enabled } = useEnabledModules();
  const auth = useAuthStatus();
  const settings = useAppSettings();
  return canOpenPath(
    manifests,
    enabled,
    auth.data &&
      settings.data &&
      (auth.isSuccess || auth.error?.code === "app.operation.busy")
      ? {
          authenticated: auth.data.state === "active",
          developerMode: settings.data.developerMode.value,
          mode: auth.data.mode,
          permissions: auth.data.permissions,
        }
      : undefined,
    path,
  );
}
