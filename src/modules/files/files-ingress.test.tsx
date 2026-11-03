import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { mockDeveloperIpc } from "@/core/core.test-support";
import type { FileIngressSnapshot } from "@/lib/generated/FileIngressSnapshot";
import { renderFiles } from "./files.test-support";

it.each(["txt", "png"])(
  "received attachments use purpose whitelist %s and explicit token submission, without another picker",
  async (extension) => {
    const inbox: FileIngressSnapshot = {
      pending: [
        {
          type: "file",
          id: "incoming",
          name: "received.txt",
          extension: "txt",
        },
      ],
      recent: [],
      issue: null,
      skippedDirectories: 0,
    };
    const calls = mockDeveloperIpc((command) => {
      if (command === "app_file_ingress_list") return structuredClone(inbox);
      if (command === "app_file_ingress_claim") {
        inbox.pending = [];
        return {
          token: "incoming-token",
          fileName: "received.txt",
          format: null,
        };
      }
      if (command === "files_file_list")
        return { items: [], total: 0, page: 1, pageSize: 20 };
      if (command === "files_file_purposes")
        return {
          items: [{ code: "files.attachment", extensions: [extension] }],
        };
      if (command === "files_file_add") return null;
    });
    renderFiles("/files");
    const dialog = within(
      await screen.findByRole("dialog", { name: "打开文件" }),
    );
    fireEvent.click(
      await dialog.findByRole("button", { name: /交给\s*文件管理/ }),
    );
    await screen.findByText(/已选择 received.txt/);
    const add = screen.getByRole("button", { name: "添加文件" });
    expect(add).toHaveProperty("disabled", true);
    expect(
      calls.mock.calls.some(([command]) => command === "files_file_add"),
    ).toBe(false);
    fireEvent.pointerDown(screen.getByRole("combobox", { name: "用途" }), {
      button: 0,
      pointerType: "mouse",
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("option", { name: "附件" }));
    if (extension === "png") {
      expect(add).toHaveProperty("disabled", true);
      expect(
        calls.mock.calls.some(([command]) => command === "files_file_add"),
      ).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "忽略" }));
      expect(screen.queryByText(/已选择 received.txt/)).toBeNull();
      expect(
        calls.mock.calls.some(([command]) => command === "app_file_pick"),
      ).toBe(false);
      return;
    }
    fireEvent.click(add);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("files_file_add", {
        input: { purpose: "files.attachment", fileToken: "incoming-token" },
      }),
    );
    expect(
      calls.mock.calls.some(([command]) => command === "app_file_pick"),
    ).toBe(false);
  },
);
