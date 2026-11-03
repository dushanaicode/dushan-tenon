import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useAppSettings } from "@/core/app-settings";
import { useAuthStatus } from "@/core/auth";
import type {
  ModuleDevPage,
  ObjectViewProps,
  ResolvedObject,
} from "@/core/contracts/module";
import {
  currentUser,
  mockAppIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { useEnabledModules } from "@/core/enabled-modules";
import { i18n } from "@/core/i18n";
import { LazyContent } from "@/core/lazy-content";
import { ModuleDirectoryProvider } from "@/core/module-directory";
import { evaluateVisibility } from "@/core/visibility";
import { StatusPage } from "@/kit";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobDetail } from "@/lib/generated/JobDetail";
import type { JobEvent } from "@/lib/generated/JobEvent";
import type { JobStatus } from "@/lib/generated/JobStatus";
import { newId } from "@/lib/id";
import type { StreamChannel } from "@/lib/ipc/stream";
import { devtoolsManifest } from "./manifest";

export const fixtureJobKind = "devtools.test_task";
export const fixtureProgressKey = "jobs.testProgress";
export const firstId = "01999000-1234-7000-8000-123456789abc";
export const secondId = "01999000-1234-7000-8000-123456789abd";
export const createdAt = "2026-10-16T10:00:00.000Z";
export const emptyProgress = {
  current: null,
  total: null,
  messageKey: null,
  params: {},
};
i18n.addResources("zh-CN", "translation", {
  [`jobs.kinds.${fixtureJobKind}`]: "测试任务",
  [fixtureProgressKey]: "已处理 {{current}} / {{total}} 项",
});
i18n.addResources("en-US", "translation", {
  [`jobs.kinds.${fixtureJobKind}`]: "Test task",
  [fixtureProgressKey]: "Processed {{current}} / {{total}} items",
});

export function jobDetail(status: JobStatus = "running"): JobDetail {
  return {
    id: firstId,
    kind: fixtureJobKind,
    module: "devtools",
    payload: {},
    priority: 0,
    status,
    attempts: 1,
    maxAttempts: 3,
    retrySafe: true,
    runAfter: createdAt,
    progress: { ...emptyProgress },
    result: null,
    errorCode: null,
    errorParams: {},
    cancelRequested: false,
    submittedBy: currentUser.id,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    rowVersion: 1,
  };
}

export function ipcError(code = "app.internal.unexpected"): IpcError {
  return { code, params: {}, traceId: "devtools-test" };
}

export function setupJobs(override?: Parameters<typeof mockAppIpc>[0]) {
  const state = { detail: jobDetail() };
  const streams: {
    id: string;
    streamId: string;
    channel: StreamChannel<JobEvent>;
  }[] = [];
  const calls = mockAppIpc(
    (command, payload) => {
      const result = override?.(command, payload);
      if (result !== undefined) return result;
      if (command === "devtools_job_get") {
        const { input } = payload as { input: { id: string } };
        return structuredClone({ ...state.detail, id: input.id });
      }
      if (command === "devtools_job_list")
        return { items: [state.detail], page: 1, pageSize: 20, total: 1 };
      if (command === "devtools_job_watch") {
        const { input, channel } = payload as {
          input: { id: string };
          channel: StreamChannel<JobEvent>;
        };
        const streamId = newId();
        streams.push({ id: input.id, streamId, channel });
        channel.onmessage({ type: "started", streamId });
        return null;
      }
      if (command === "app_stream_cancel") return null;
    },
    { developerMode: { value: true, source: "file" } },
  );
  return { state, streams, calls };
}

export function objectProps(id = firstId): ObjectViewProps {
  const object: ResolvedObject = {
    ref: { kind: "job", id },
    title: "测试任务",
    iconId: "jobs",
  };
  return { object, onUnavailable: () => {} };
}

export function renderDevtools(children: ReactNode, path = "/devtools/jobs") {
  const { client, wrapper: QueryProvider } = queryWrapper();
  const view = render(children, {
    wrapper: ({ children }) => (
      <QueryProvider>
        <ModuleDirectoryProvider manifests={[devtoolsManifest]}>
          <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
        </ModuleDirectoryProvider>
      </QueryProvider>
    ),
  });
  return { ...view, client };
}

// 用现行 core 可见性合同装配本模块路由，测试不依赖 app 或 shell。
function DevPage({ page }: { page: ModuleDevPage }) {
  const auth = useAuthStatus();
  const modules = useEnabledModules();
  const settings = useAppSettings();
  if (auth.isPending || modules.isPending || settings.isPending) return null;
  if (auth.error || modules.error || settings.error)
    return <StatusPage kind="error" />;
  if (!modules.enabled?.has("devtools")) return <StatusPage kind="notFound" />;
  const access = evaluateVisibility(
    { ...page, developerOnly: true },
    {
      authenticated: auth.data.state === "active",
      mode: auth.data.mode,
      permissions: auth.data.permissions,
      developerMode: settings.data.developerMode.value,
    },
  );
  return access === "visible" ? (
    <LazyContent factory={page.Component} />
  ) : (
    <StatusPage kind={access} />
  );
}

export function renderDevtoolsPage(path: string) {
  return renderDevtools(
    <Routes>
      {devtoolsManifest.devPages.map((page) => (
        <Route
          key={page.path}
          path={page.path}
          element={<DevPage page={page} />}
        />
      ))}
    </Routes>,
    path,
  );
}
