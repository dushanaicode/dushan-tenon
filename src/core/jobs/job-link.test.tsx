import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test } from "vitest";
import {
  currentUser,
  mockAppIpc,
  mockDeveloperIpc,
} from "@/core/core.test-support";
import { createQueryClient } from "@/core/query-client";
import type { AppSettings } from "@/lib/generated/AppSettings";
import { ModuleDirectoryProvider } from "../module-directory";
import { testManifest } from "../module-directory.test-support";
import { JobLink, useJobPath } from "./job-link";

const clients: ReturnType<typeof createQueryClient>[] = [];

test("job paths come from the injected object contribution, including removal", async () => {
  mockDeveloperIpc();
  const client = createQueryClient();
  clients.push(client);
  const manifest = testManifest();
  const injected = {
    ...manifest,
    basePath: "/tools",
    devPages: [{ ...manifest.devPages[0], path: "/tools/task/:id" }],
    workbenchObjects: [
      { ...manifest.workbenchObjects[0], route: "/tools/task/:id" },
    ],
  };
  const view = render(
    <QueryClientProvider client={client}>
      <ModuleDirectoryProvider manifests={[injected]}>
        <MemoryRouter>
          <JobLink id="job-1">Destination</JobLink>
        </MemoryRouter>
      </ModuleDirectoryProvider>
    </QueryClientProvider>,
  );
  expect(
    (await screen.findByRole("link", { name: "Destination" })).getAttribute(
      "href",
    ),
  ).toBe("/tools/task/job-1");
  view.rerender(
    <QueryClientProvider client={client}>
      <ModuleDirectoryProvider manifests={[]}>
        <MemoryRouter>
          <JobLink id="job-1">Destination</JobLink>
        </MemoryRouter>
      </ModuleDirectoryProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("link", { name: "Destination" })).toBeNull();
});

afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

test.each(["loading", "error", "ready"])(
  "notification_job_target_respects_route_module_and_permission: %s_and_null",
  async (state) => {
    mockDeveloperIpc((command) => {
      if (command !== "app_modules_list") return;
      if (state === "loading") return new Promise(() => {});
      if (state === "error")
        throw {
          code: "app.internal.unexpected",
          params: {},
          traceId: "job-modules",
        };
    });
    const client = createQueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    clients.push(client);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useJobPath(id),
      {
        initialProps: { id: "job-1" } as { id: string | null },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <ModuleDirectoryProvider manifests={[testManifest()]}>
              {children}
            </ModuleDirectoryProvider>
          </QueryClientProvider>
        ),
      },
    );
    const queryStatus =
      state === "loading" ? "pending" : state === "error" ? "error" : "success";
    await waitFor(() =>
      expect(client.getQueryState(["app", "modules"])?.status).toBe(
        queryStatus,
      ),
    );
    const expected = state === "ready" ? "/devtools/jobs/job-1" : undefined;
    await waitFor(() => expect(result.current).toBe(expected));
    rerender({ id: null });
    expect(result.current).toBeUndefined();
    rerender({ id: "job-1" });
    expect(result.current).toBe(expected);
  },
);

test.each([
  [false, true, false],
  [true, false, false],
  [true, true, true],
])(
  "job destinations respect developer mode: mode=%s permission=%s",
  async (developerMode, permitted, visible) => {
    mockAppIpc(
      (command) => {
        if (command === "account_auth_status")
          return {
            state: "active",
            mode: "none",
            user: currentUser,
            permissions: permitted ? ["devtools.job.read"] : [],
            idleLockMinutes: 15,
          };
      },
      { developerMode: { value: developerMode, source: "file" } },
    );
    const client = createQueryClient();
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <ModuleDirectoryProvider manifests={[testManifest()]}>
          <MemoryRouter>
            <JobLink id="job-1">Destination</JobLink>
          </MemoryRouter>
        </ModuleDirectoryProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const link = screen.queryByRole("link", { name: "Destination" });
    expect(Boolean(link)).toBe(visible);
    if (visible)
      expect(link?.getAttribute("href")).toBe("/devtools/jobs/job-1");
    await act(async () => {
      client.setQueryData<AppSettings>(["app", "settings"], (settings) => {
        if (!settings) throw new Error("设置夹具未就绪");
        return { ...settings, developerMode: { value: false, source: "file" } };
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Destination" })).toBeNull(),
    );
  },
);
