import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import { currentUser } from "@/core/core.test-support";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { FilePicked } from "@/lib/generated/FilePicked";
import type { FilePreview } from "@/lib/generated/FilePreview";
import type { FileSummary } from "@/lib/generated/FileSummary";
import type { FileTextPage } from "@/lib/generated/FileTextPage";
import type { Page } from "@/lib/generated/Page";
import {
  mockFilesIpc,
  renderFiles,
  row,
  selectValue,
} from "./files.test-support";

test.each([
  ["add", "identity"],
  ["add", "lock"],
  ["add", "permission"],
  ["save", "identity"],
  ["save", "lock"],
  ["save", "permission"],
] as const)(
  "late %s picker is discarded after %s changes",
  async (action, change) => {
    let resolvePick!: (value: FilePicked) => void;
    const calls = mockFilesIpc({}, (command) =>
      command === "app_file_pick"
        ? new Promise<FilePicked>((resolve) => {
            resolvePick = resolve;
          })
        : undefined,
    );
    const f = renderFiles();
    await screen.findByText(row.originalName);
    if (action === "add") await selectValue("用途", "附件");
    fireEvent.click(
      screen.getByRole("button", {
        name: action === "add" ? "添加文件" : "另存为",
      }),
    );
    await waitFor(() => expect(resolvePick).toBeDefined());
    const auth = f.client.getQueryData<AuthStatus>(authKey) as AuthStatus;
    await act(async () => {
      f.client.setQueryData<AuthStatus>(authKey, {
        ...auth,
        ...(change === "identity"
          ? { user: { ...currentUser, id: "other-user" } }
          : change === "lock"
            ? { state: "locked", permissions: [] }
            : { permissions: ["files.file.read"] }),
      });
      resolvePick({
        token: "late-token",
        fileName: row.originalName,
        format: null,
      });
    });
    expect(
      calls.mock.calls.some(
        ([command]) =>
          command === "files_file_add" || command === "files_file_save_copy",
      ),
    ).toBe(false);
    expect(screen.queryByText("已添加文件。")).toBeNull();
    expect(screen.queryByText("已另存文件。")).toBeNull();
  },
);

test("a late file list cannot appear or enter the next identity's query cache", async () => {
  let resolveList!: (value: Page<FileSummary>) => void;
  let first = true;
  mockFilesIpc({}, (command) => {
    if (command !== "files_file_list") return;
    if (first) {
      first = false;
      return new Promise<Page<FileSummary>>((resolve) => {
        resolveList = resolve;
      });
    }
    return {
      items: [{ ...row, originalName: "next-owner.txt" }],
      total: 1,
      page: 1,
      pageSize: 20,
    };
  });
  const f = renderFiles();
  await waitFor(() => expect(resolveList).toBeDefined());
  const auth = f.client.getQueryData<AuthStatus>(authKey) as AuthStatus;
  await act(async () => {
    f.client.setQueryData(authKey, {
      ...auth,
      user: { ...currentUser, id: "next-owner" },
    });
  });
  await screen.findByText("next-owner.txt");
  await act(async () =>
    resolveList({ items: [row], total: 1, page: 1, pageSize: 20 }),
  );
  expect(screen.queryByText(row.originalName)).toBeNull();
  expect(
    f.client.getQueryData<Page<FileSummary>>([
      "files",
      "next-owner",
      "list",
      1,
      "",
      "",
    ])?.items[0].originalName,
  ).toBe("next-owner.txt");
  expect(
    f.client.getQueryData(["files", currentUser.id, "list", 1, "", ""]),
  ).toBeUndefined();
});

test.each(["txt", "png"])(
  "locking removes an open %s preview and discards its late body",
  async (extension) => {
    let resolvePreview!: (value: FilePreview | FileTextPage) => void;
    mockFilesIpc({ file: { ...row, extension } }, (command) =>
      command === "files_file_preview" || command === "files_file_text_page"
        ? new Promise<FilePreview | FileTextPage>((resolve) => {
            resolvePreview = resolve;
          })
        : undefined,
    );
    const f = renderFiles();
    fireEvent.click(await screen.findByRole("button", { name: "预览" }));
    await waitFor(() => expect(resolvePreview).toBeDefined());
    const auth = f.client.getQueryData<AuthStatus>(authKey) as AuthStatus;
    await act(async () => {
      f.client.setQueryData(authKey, {
        ...auth,
        state: "locked",
        permissions: [],
      });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () =>
      resolvePreview(
        extension === "txt"
          ? {
              text: "private-body",
              offset: 0,
              nextOffset: null,
              totalBytes: 12,
              fingerprint: "old",
            }
          : {
              type: "image",
              mime: "image/png",
              dataUrl: "data:image/png;base64,private-body",
            },
      ),
    );
    expect(screen.queryByText("private-body")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    await waitFor(() =>
      expect(
        f.client.getQueryCache().findAll({
          queryKey: [
            "files",
            currentUser.id,
            extension === "txt" ? "text-page" : "preview",
          ],
        }),
      ).toHaveLength(0),
    );
  },
);
