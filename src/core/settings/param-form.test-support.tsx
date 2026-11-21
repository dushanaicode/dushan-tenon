import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach } from "vitest";
import {
  type AppFixture,
  activeAuth,
  appModules,
  currentUser,
  mockAppIpc,
  paramEntries,
} from "@/core/core.test-support";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { i18n } from "@/core/i18n";
import { createQueryClient } from "@/core/query-client";
import type { IpcError } from "@/lib/generated/IpcError";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { SettingsDraftProvider } from "./drafts";
import { ParamForm } from "./param-form";
import { SettingsActionBar } from "./settings-action-bar";

const accountName = "空闲自动锁定（分钟）";
const sampleName = "批次大小";

// 测试专用的样板模块，不对应任何真实模块：覆盖整数、文本、秘密三种参数，
// 读写都要一项模块权限，模块可以停用。核心设置的测试用它，不借用业务模块。
const samplePermission = "sample.settings.manage";
const sampleParams: ParamEntry[] = (
  [
    {
      key: "sample.batch_size",
      kind: { type: "integer", min: 1, max: 100 },
      value: "25",
      order: 10,
      effect: "nextJob",
    },
    {
      key: "sample.test_text",
      kind: { type: "text", maxChars: 4 },
      value: "a",
      order: 20,
      effect: "nextRead",
    },
    {
      key: "sample.test_secret",
      kind: { type: "secret" },
      value: null,
      order: 30,
      effect: "nextRead",
    },
  ] satisfies Pick<ParamEntry, "key" | "kind" | "value" | "order" | "effect">[]
).map(
  (entry): ParamEntry => ({
    ...entry,
    moduleId: "sample",
    default: entry.value,
    isDefault: true,
    secretSet: false,
    rowVersion: null,
    updatedAt: null,
    group: "sample.work",
    readPermission: samplePermission,
    writePermission: samplePermission,
    source: "default",
  }),
);
const sampleFixture: AppFixture = {
  modules: {
    modules: [
      ...appModules.modules,
      {
        id: "sample",
        version: "0.1.0-alpha.1",
        enabled: true,
        core: false,
        appliedMigrations: 0,
      },
    ],
  },
  params: [...paramEntries, ...sampleParams],
  auth: {
    ...activeAuth,
    permissions: [...activeAuth.permissions, samplePermission],
  },
};
i18n.addResources("zh-CN", "translation", {
  "param.group.sample.work": "样板参数",
  "param.sample.batch_size.name": sampleName,
  "param.sample.test_text.name": "测试文本",
  "param.sample.test_secret.name": "测试秘密",
  "permissions.sample.settings.manage": "管理样板参数",
});
i18n.addResources("en-US", "translation", {
  "param.group.sample.work": "Sample parameters",
  "param.sample.batch_size.name": "Batch size",
  "param.sample.test_text.name": "Test text",
  "param.sample.test_secret.name": "Test secret",
  "permissions.sample.settings.manage": "Manage sample parameters",
});

function mockSampleIpc(override?: Parameters<typeof mockAppIpc>[0]) {
  return mockAppIpc(override, {}, sampleFixture);
}
const listKey = ["app", "setting", currentUser.id, false];
const clients: QueryClient[] = [];

function mount(includeDisabled = false) {
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider
          router={createMemoryRouter([
            {
              path: "*",
              element: (
                <EditSessionsProvider>
                  <SettingsDraftProvider>
                    <ParamForm includeDisabled={includeDisabled} />
                    <SettingsActionBar />
                  </SettingsDraftProvider>
                </EditSessionsProvider>
              ),
            },
          ])}
        />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

function row(name: string) {
  return within(screen.getByRole("form", { name }));
}

function edit(name: string, value: string) {
  fireEvent.change(row(name).getByRole("textbox", { name }), {
    target: { value },
  });
}

function stored(entry: ParamEntry, value: string, version: number): ParamEntry {
  return {
    ...entry,
    value,
    isDefault: value === entry.default,
    rowVersion: version,
    source: "database",
    updatedAt: "2026-10-19T00:00:00.000Z",
  };
}

function conflict(): IpcError {
  return {
    code: "app.data.version_conflict",
    params: {},
    traceId: "setting-conflict",
  };
}

export {
  accountName,
  conflict,
  edit,
  listKey,
  mockSampleIpc,
  mount,
  row,
  sampleFixture,
  sampleName,
  sampleParams,
  samplePermission,
  stored,
};
