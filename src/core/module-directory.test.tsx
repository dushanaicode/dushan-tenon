import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { mockDeveloperIpc, queryWrapper } from "./core.test-support";
import { canOpenPath, useCanOpen, useEnabledModules } from "./enabled-modules";
import {
  ModuleDirectoryProvider,
  moduleOfPath,
  moduleRoutes,
  routeOfPath,
} from "./module-directory";
import { testManifest } from "./module-directory.test-support";
import type { VisibilityAuth } from "./visibility";

const manifest = testManifest();
const auth: VisibilityAuth = {
  authenticated: true,
  developerMode: true,
  mode: "none",
  permissions: ["devtools.job.read"],
};
const enabled = new Set([manifest.id]);

it.each([
  ["/devtools/jobs/one", true],
  ["/devtools/jobs/", false],
  ["/devtools/jobs/one/other", false],
  ["/devtools/unknown", false],
  ["/devtools-other/jobs/one", false],
  ["/missing", false],
  ["/", true],
  ["/settings", true],
])(
  "uses router matching for %s and rejects unknown paths",
  (path, expected) => {
    expect(canOpenPath([manifest], enabled, auth, path)).toBe(expected);
  },
);

it("requires enabled modules, active identity, developer mode and permission without loading components", () => {
  const factory = vi.fn(async () => ({ default: () => null }));
  const item = testManifest({
    devPages: [{ ...manifest.devPages[0], Component: factory }],
  });
  const path = "/devtools/jobs/one";
  expect(moduleOfPath([item], path)).toBe(item);
  expect(moduleRoutes(item)[0].developerOnly).toBe(true);
  expect(routeOfPath(item, path)?.Component).toBe(factory);
  for (const patch of [
    { authenticated: false },
    { developerMode: false },
    { permissions: [] },
  ]) {
    expect(canOpenPath([item], enabled, { ...auth, ...patch }, path)).toBe(
      false,
    );
  }
  expect(canOpenPath([item], new Set(), auth, path)).toBe(false);
  expect(canOpenPath([item], undefined, auth, path)).toBe(false);
  expect(canOpenPath([item], enabled, undefined, path)).toBe(false);
  expect(canOpenPath([], enabled, auth, path)).toBe(false);
  expect(factory).not.toHaveBeenCalled();
});

it("uses only the supplied directory and distinguishes query loading and errors", async () => {
  mockDeveloperIpc((command) => {
    if (command === "app_modules_list")
      throw {
        code: "app.internal.unexpected",
        params: {},
        traceId: "directory-failure",
      };
  });
  const { wrapper: QueryWrapper } = queryWrapper();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryWrapper>
      <ModuleDirectoryProvider manifests={[manifest]}>
        {children}
      </ModuleDirectoryProvider>
    </QueryWrapper>
  );
  const { result } = renderHook(
    () => ({
      modules: useEnabledModules(),
      allowed: useCanOpen("/devtools/jobs/one"),
    }),
    { wrapper },
  );
  expect(result.current.modules.isPending).toBe(true);
  expect(result.current.allowed).toBe(false);
  await waitFor(() =>
    expect(result.current.modules.error?.traceId).toBe("directory-failure"),
  );
  expect(result.current.modules.isPending).toBe(false);
  expect(result.current.modules.enabled).toBeUndefined();
  expect(result.current.allowed).toBe(false);
});
