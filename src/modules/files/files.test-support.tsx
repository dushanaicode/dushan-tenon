import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { useAuthStatus } from "@/core/auth";
import {
  currentUser,
  mockDeveloperIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { FileIngressProvider } from "@/core/file-ingress";
import { ModuleDirectoryProvider } from "@/core/module-directory";
import { usePageSessionScope } from "@/core/page-session";
import type { FilePreview } from "@/lib/generated/FilePreview";
import type { FileSummary } from "@/lib/generated/FileSummary";
import { FilesPage } from "./files-page";
import { filesManifest } from "./manifest";

function SessionScope({ children }: { children: ReactNode }) {
  const auth = useAuthStatus();
  usePageSessionScope(auth.data?.user?.id ?? "");
  return children;
}

export function renderFiles(path = "/files") {
  const { client } = queryWrapper();
  const router = createMemoryRouter(
    [
      {
        element: (
          <SessionScope>
            <FileIngressProvider>
              <Outlet />
            </FileIngressProvider>
          </SessionScope>
        ),
        children: [
          { path: "/", element: <h1>首页</h1> },
          { path: "/files", element: <FilesPage /> },
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
        <ModuleDirectoryProvider manifests={[filesManifest]}>
          <RouterProvider router={router} />
        </ModuleDirectoryProvider>
      </QueryClientProvider>,
    ),
  };
}

export const row: FileSummary = {
  id: "file-one",
  purpose: "files.attachment",
  originalName: "说明.txt",
  extension: "txt",
  sizeBytes: 2048,
  sha256: "a".repeat(64),
  createdAt: "2026-10-17T00:00:00.000Z",
  createdBy: "owner-id",
  missing: false,
  rowVersion: 3,
};
export function mockFilesIpc(
  {
    writable = true,
    file = row,
    cancel = false,
    total = 1,
    preview = {
      type: "text",
      text: "文本内容",
      truncated: true,
    } as FilePreview,
    error = false,
    pages = false,
  } = {},
  override?: Parameters<typeof mockDeveloperIpc>[0],
) {
  let rows = [file];
  const calls = mockDeveloperIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    switch (command) {
      case "app_file_ingress_list":
        return { pending: [], recent: [], issue: null, skippedDirectories: 0 };
      case "account_auth_status":
        return {
          mode: "none",
          state: "active",
          user: currentUser,
          permissions: writable
            ? ["files.file.read", "files.file.write"]
            : ["files.file.read"],
          idleLockMinutes: 15,
        };
      case "files_file_purposes":
        return {
          items: [
            {
              code: "files.attachment",
              extensions: ["txt", "png", "pdf", "xlsx"],
            },
          ],
        };
      case "files_file_list": {
        if (error)
          return Promise.reject({
            code: "app.file.missing",
            params: {},
            traceId: "trace",
          });
        const input = (payload as { input: { page: number } }).input;
        return { items: rows, total, page: input.page, pageSize: 20 };
      }
      case "app_file_pick":
        return cancel
          ? null
          : {
              token: "selected-token",
              fileName: file.originalName,
              format: null,
            };
      case "files_file_add":
        return file;
      case "files_file_preview":
        return preview;
      case "files_file_text_page": {
        const { input } = payload as {
          input: { offset: number; fingerprint: string | null };
        };
        const text =
          input.offset === 0 && preview.type === "text"
            ? preview.text
            : "nextpart";
        return {
          text,
          offset: input.offset,
          nextOffset: pages && input.offset === 0 ? 12 : null,
          totalBytes: pages ? 20 : new TextEncoder().encode(text).length,
          fingerprint: "b".repeat(64),
        };
      }
      case "files_file_save_copy":
        return null;
      case "files_file_delete":
        rows = [];
        return null;
      case "files_file_reclaim":
        return {
          orphanFiles: 2,
          orphanBytes: 2048,
          staleTmp: 3,
          missingRows: 4,
          failed: 1,
        };
    }
  });
  return calls;
}

export function fixture(...args: Parameters<typeof mockFilesIpc>) {
  const calls = mockFilesIpc(...args);
  renderFiles();
  return calls;
}

export async function selectValue(label: string, option: string) {
  fireEvent.pointerDown(await screen.findByRole("combobox", { name: label }), {
    button: 0,
    pointerType: "mouse",
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
