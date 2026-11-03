import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach } from "vitest";
import { currentUser } from "@/core/core.test-support";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { createQueryClient } from "@/core/query-client";
import type { IpcError } from "@/lib/generated/IpcError";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { SettingsDraftProvider } from "./drafts";
import { ParamForm } from "./param-form";
import { SettingsActionBar } from "./settings-action-bar";

const accountName = "空闲自动锁定（分钟）";
const aiName = "连接超时（秒）";
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

export { accountName, aiName, conflict, edit, listKey, mount, row, stored };
