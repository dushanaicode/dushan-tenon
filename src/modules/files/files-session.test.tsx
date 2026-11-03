import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { mockDeveloperIpc } from "@/core/core.test-support";
import { renderFiles } from "./files.test-support";

it("file list restores the applied purpose, keyword, page and main scroll", async () => {
  const calls = mockDeveloperIpc((command, payload) => {
    if (command === "app_file_ingress_list")
      return { pending: [], recent: [], issue: null, skippedDirectories: 0 };
    if (command === "files_file_purposes")
      return { items: [{ code: "files.attachment", extensions: ["txt"] }] };
    if (command === "files_file_list") {
      const { page, pageSize } = (
        payload as { input: { page: number; pageSize: number } }
      ).input;
      const rows = Array.from({ length: 42 }, (_, index) => ({
        id: `file-${index}`,
        purpose: "files.attachment",
        originalName: `session-${index}.txt`,
        extension: "txt",
        sizeBytes: 12,
        sha256: "a".repeat(64),
        createdAt: "2026-10-28T00:00:00.000Z",
        createdBy: "owner",
        missing: false,
        rowVersion: 1,
      }));
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize,
      };
    }
  });
  const f = renderFiles("/files");
  await screen.findByText("session-0.txt");
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "用途" }), {
    button: 0,
    pointerType: "mouse",
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("option", { name: "附件" }));
  fireEvent.change(screen.getByRole("textbox", { name: "文件名关键字" }), {
    target: { value: "session-" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("files_file_list", {
      input: {
        page: 1,
        pageSize: 20,
        purpose: "files.attachment",
        keyword: "session-",
      },
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
  await screen.findByText("session-20.txt");
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  fireEvent.scroll(
    screen.getByRole("region", { name: "只显示本实例登记的本机文件。" }),
    {
      target: { scrollTop: 350 },
    },
  );
  await act(async () => f.router.navigate("/"));

  await act(async () => f.router.navigate("/files"));
  await screen.findByText("session-20.txt");
  expect(screen.getByRole("textbox", { name: "文件名关键字" })).toHaveProperty(
    "value",
    "session-",
  );
  expect(screen.getByRole("combobox", { name: "用途" }).textContent).toContain(
    "附件",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "只显示本实例登记的本机文件。" })
        .scrollTop,
    ).toBe(350),
  );
});
