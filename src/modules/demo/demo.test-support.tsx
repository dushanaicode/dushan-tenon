import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, assert, beforeEach, vi } from "vitest";
import {
  appModules,
  currentUser,
  mockAppIpc,
  paramEntries,
  queryWrapper,
} from "@/core/core.test-support";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { FileIngressProvider } from "@/core/file-ingress";
import { ModuleDirectoryProvider } from "@/core/module-directory";
import { testManifest } from "@/core/module-directory.test-support";
import { SettingsDraftProvider } from "@/core/settings/drafts";
import { SettingsActionBar } from "@/core/settings/settings-action-bar";
import type { AppModules } from "@/lib/generated/AppModules";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { DemoDraftLease } from "@/lib/generated/DemoDraftLease";
import type { DemoDraftOpen } from "@/lib/generated/DemoDraftOpen";
import type { DemoDraftWrite } from "@/lib/generated/DemoDraftWrite";
import type { DemoListInput } from "@/lib/generated/DemoListInput";
import type { DemoSample } from "@/lib/generated/DemoSample";
import type { DemoSampleDraft } from "@/lib/generated/DemoSampleDraft";
import type { FilePicked } from "@/lib/generated/FilePicked";
import type { JobEvent } from "@/lib/generated/JobEvent";
import type { JobSnapshot } from "@/lib/generated/JobSnapshot";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import type { StreamEvent } from "@/lib/generated/StreamEvent";
import { newId } from "@/lib/id";
import type { StreamChannel } from "@/lib/ipc/stream";
import DemoJobPage from "./job-page";
import DemoMeasurePage from "./measure-page";
import DemoSamplePage from "./sample-detail";
import DemoSamplesPage from "./samples-page";
import DemoSettingsSection from "./settings-section";

export const demoAppModules: AppModules = {
  modules: appModules.modules,
};

export const demoParamEntries: ParamEntry[] = [
  ...paramEntries.filter((entry) => entry.moduleId !== "demo"),
  {
    key: "demo.batch_size",
    moduleId: "demo",
    kind: { type: "integer", min: 1, max: 100 },
    value: "25",
    default: "25",
    isDefault: true,
    secretSet: false,
    rowVersion: null,
    updatedAt: null,
    group: "demo.work",
    order: 10,
    readPermission: "demo.settings.manage",
    writePermission: "demo.settings.manage",
    effect: "nextJob",
    source: "default",
  },
];

export function mockDemoIpc(
  override?: Parameters<typeof mockAppIpc>[0],
  settingsPatch: Partial<AppSettings> = {},
) {
  return mockAppIpc(
    (command, payload) => {
      const custom = override?.(command, payload);
      if (custom !== undefined) return custom;
      if (command === "app_modules_list") return demoAppModules;
      if (command === "app_setting_list")
        return structuredClone(demoParamEntries);
      if (command === "app_file_ingress_list")
        return { pending: [], recent: [], issue: null, skippedDirectories: 0 };
      if (command === "demo_overview_get")
        return { total: 0, ready: 0, recent: [] };
    },
    { developerMode: { value: true, source: "file" }, ...settingsPatch },
  );
}

export const sample: DemoSample = {
  id: "01999000-1234-7000-8000-123456789abd",
  code: "CARD-1",
  title: "真实练习卡",
  note: "你好🌍",
  stage: "draft",
  characterCount: null,
  attachment: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  rowVersion: 3,
};

export const jobSnapshot: JobSnapshot = {
  id: "job-1",
  kind: "demo.measure",
  module: "demo",
  payload: {},
  priority: 0,
  status: "queued",
  attempts: 0,
  maxAttempts: 1,
  retrySafe: false,
  runAfter: sample.createdAt,
  progress: { current: null, total: null, messageKey: null, params: {} },
  result: null,
  errorCode: null,
  errorParams: {},
  cancelRequested: false,
  submittedBy: currentUser.id,
  createdAt: sample.createdAt,
  updatedAt: sample.createdAt,
  startedAt: null,
  finishedAt: null,
  rowVersion: 1,
};

export function setupDemo(
  path: string,
  override?: Parameters<typeof mockDemoIpc>[0],
  initialRows: DemoSample[] = [sample],
) {
  const state = {
    rows: structuredClone(initialRows),
    drafts: new Map<string, DemoSampleDraft>(),
    job: structuredClone(jobSnapshot),
    file: {
      token: "picked-token",
      fileName: "sample.txt",
      format: null,
    } as FilePicked | null,
    channels: [] as StreamChannel<JobEvent>[],
  };
  const calls = mockDemoIpc((command, payload) => {
    const custom = override?.(command, payload);
    if (custom !== undefined) return custom;
    if (command === "demo_draft_open") {
      const { sampleId } = (payload as { input: DemoDraftOpen }).input;
      const row = state.rows.find((row) => row.id === sampleId);
      const key = sampleId ?? "new";
      const old = state.drafts.get(key);
      const baseline = {
        code: row?.code ?? "",
        title: row?.title ?? "",
        note: row?.note ?? "",
      };
      const draft: DemoSampleDraft = {
        lease: {
          id: old?.lease.id ?? newId(),
          sessionId: newId(),
          revision: 0,
        },
        sampleId,
        baseVersion: old?.baseVersion ?? row?.rowVersion ?? null,
        baseline,
        fields: old?.fields ?? baseline,
        recovered: old?.recovered ?? false,
        conflict:
          old !== undefined && old.baseVersion !== (row?.rowVersion ?? null),
        updatedAt: sample.updatedAt,
      };
      state.drafts.set(key, draft);
      return structuredClone(draft);
    }
    if (command === "demo_draft_write") {
      const { lease, fields } = (payload as { input: DemoDraftWrite }).input;
      const draft = [...state.drafts.values()].find(
        (draft) => draft.lease.id === lease.id,
      );
      assert(draft);
      assert(
        draft.lease.sessionId === lease.sessionId &&
          draft.lease.revision === lease.revision,
      );
      draft.fields = fields;
      draft.recovered =
        JSON.stringify(fields) !== JSON.stringify(draft.baseline);
      draft.lease.revision += 1;
      return { revision: draft.lease.revision, updatedAt: sample.updatedAt };
    }
    if (command === "demo_draft_discard" || command === "demo_draft_commit") {
      const lease = (payload as { input: DemoDraftLease }).input;
      const entry = [...state.drafts.entries()].find(
        ([, draft]) => draft.lease.id === lease.id,
      );
      assert(entry);
      const [key, draft] = entry;
      assert(
        draft.lease.sessionId === lease.sessionId &&
          draft.lease.revision === lease.revision,
      );
      if (command === "demo_draft_discard") {
        state.drafts.delete(key);
        return null;
      }
      const previous = state.rows.find((row) => row.id === draft.sampleId);
      const saved = {
        ...sample,
        ...draft.fields,
        id: previous?.id ?? newId(),
        rowVersion: (previous?.rowVersion ?? 0) + 1,
        stage: "draft" as const,
        characterCount: null,
      };
      state.rows = previous
        ? state.rows.map((row) => (row.id === previous.id ? saved : row))
        : [...state.rows, saved];
      state.drafts.delete(key);
      return saved;
    }
    if (command === "demo_overview_get")
      return {
        total: state.rows.length,
        ready: state.rows.filter((row) => row.stage === "ready").length,
        recent: state.rows.slice(0, 5),
      };
    if (command === "demo_sample_list") {
      const input = (payload as { input: DemoListInput }).input;
      const rows = state.rows.filter(
        (row) =>
          (!input.keyword ||
            row.code.includes(input.keyword) ||
            row.title.includes(input.keyword)) &&
          (!input.stage || row.stage === input.stage),
      );
      return {
        items: rows.slice(
          (input.page - 1) * input.pageSize,
          input.page * input.pageSize,
        ),
        total: rows.length,
        page: input.page,
        pageSize: input.pageSize,
      };
    }
    if (command === "demo_sample_get") {
      const row = state.rows.find(
        (row) => row.id === (payload as { input: { id: string } }).input.id,
      );
      return row
        ? structuredClone(row)
        : Promise.reject({
            code: "demo.sample.not_found",
            params: {},
            traceId: "missing-trace",
          });
    }
    if (
      command === "demo_sample_export" ||
      command === "demo_sample_import" ||
      command === "demo_measure_start"
    )
      return { jobId: state.job.id };
    if (command === "app_file_pick") return state.file;
    if (command === "app_job_mine_get") return structuredClone(state.job);
    if (command === "app_job_mine_cancel" || command === "app_stream_cancel")
      return null;
    if (command === "app_job_mine_watch") {
      const { channel } = payload as { channel: StreamChannel<JobEvent> };
      state.channels.push(channel);
      channel.onmessage({
        type: "started",
        streamId: `job-stream-${state.channels.length}`,
      });
      return null;
    }
  });
  return { state, calls, ...renderDemo(path) };
}

export async function jobEvent(
  state: ReturnType<typeof setupDemo>["state"],
  event: StreamEvent<JobEvent>,
) {
  await waitFor(() => expectChannel(state));
  const channel = state.channels.at(-1);
  assert(channel);
  await act(async () => channel.onmessage(event));
}

function expectChannel(state: ReturnType<typeof setupDemo>["state"]) {
  assert(state.channels.length > 0);
}

// Direct component routes; this fixture never loads a production module manifest.
const fileDirectory = [
  testManifest({
    id: "demo",
    basePath: "/demo",
    workbenchObjects: [],
    devPages: [
      {
        path: "/demo/samples",
        permission: "demo.sample.read",
        Component: async () => ({ default: () => null }),
      },
    ],
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
  }),
];
export function renderDemo(path: string) {
  const { client } = queryWrapper();
  const router = createMemoryRouter(
    [
      {
        element: (
          <ModuleDirectoryProvider manifests={fileDirectory}>
            <EditSessionsProvider>
              <FileIngressProvider>
                <Outlet />
              </FileIngressProvider>
            </EditSessionsProvider>
          </ModuleDirectoryProvider>
        ),
        children: [
          { path: "/", element: <h1>首页</h1> },
          { path: "/demo/samples", element: <DemoSamplesPage /> },
          { path: "/demo/samples/:id", element: <DemoSamplePage /> },
          { path: "/demo/measure", element: <DemoMeasurePage /> },
          { path: "/demo/jobs/:id", element: <DemoJobPage /> },
          {
            path: "/settings/demo",
            element: (
              <SettingsDraftProvider>
                <DemoSettingsSection />
                <SettingsActionBar />
              </SettingsDraftProvider>
            ),
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) =>
      Object.assign(new EventTarget(), { matches: false, media }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
