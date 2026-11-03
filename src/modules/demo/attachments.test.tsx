import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { sample, setupDemo } from "./demo.test-support";

test("attachments use file tokens, real previews, version checks and accurate cleanup wording", async () => {
  const fixture = setupDemo(`/demo/samples/${sample.id}`, (command) => {
    if (command === "demo_attachment_add") {
      fixture.state.rows = [
        {
          ...sample,
          rowVersion: 4,
          attachment: {
            id: "file-1",
            name: "note.md",
            extension: "md",
            bytes: 12,
            missing: false,
          },
        },
      ];
      return fixture.state.rows[0];
    }
    if (command === "demo_attachment_preview")
      return { type: "text", text: "# 实际附件正文", truncated: false };
    if (command === "demo_attachment_save") return null;
    if (command === "demo_attachment_remove") {
      fixture.state.rows = [{ ...sample, rowVersion: 5 }];
      return fixture.state.rows[0];
    }
  });
  fireEvent.click(await screen.findByRole("button", { name: "添加附件" }));
  await screen.findByText("note.md · 12 B");
  expect(fixture.calls).toHaveBeenCalledWith("demo_attachment_add", {
    input: { id: sample.id, rowVersion: 3, fileToken: "picked-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览附件" }));
  const preview = within(
    await screen.findByRole("dialog", { name: "note.md" }),
  );
  await preview.findByText("# 实际附件正文");
  fireEvent.click(preview.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "另存附件" }));
  await screen.findByText("附件已另存。");
  expect(fixture.calls).toHaveBeenCalledWith("demo_attachment_save", {
    input: { id: sample.id, fileToken: "picked-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "移除附件" }));
  const confirm = within(await screen.findByRole("alertdialog"));
  fireEvent.click(confirm.getByRole("button", { name: "确认移除" }));
  await screen.findByText(
    "关联与登记已移除；磁盘内容由内核回收，失败时稍后回收。",
  );
  expect(fixture.calls).toHaveBeenCalledWith("demo_attachment_remove", {
    input: { id: sample.id, rowVersion: 4 },
  });
  expect(screen.queryByText(/已彻底删除|已擦除/)).toBeNull();
});

test.each(["pdf", "png"])(
  "attachment preview support follows the actual %s extension",
  async (extension) => {
    const { calls } = setupDemo(
      `/demo/samples/${sample.id}`,
      (command) =>
        command === "demo_attachment_preview"
          ? {
              type: "image",
              mime: "image/png",
              dataUrl: "data:image/png;base64,AA==",
            }
          : undefined,
      [
        {
          ...sample,
          attachment: {
            id: "attachment",
            name: `file.${extension}`,
            extension,
            bytes: 2,
            missing: false,
          },
        },
      ],
    );
    await screen.findByRole("button", { name: "另存附件" });
    if (extension === "pdf") {
      expect(screen.queryByRole("button", { name: "预览附件" })).toBeNull();
      expect(
        calls.mock.calls.some(([name]) => name === "demo_attachment_preview"),
      ).toBe(false);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "预览附件" }));
      expect(
        (await screen.findByRole("img", { name: "file.png" })).getAttribute(
          "src",
        ),
      ).toBe("data:image/png;base64,AA==");
    }
  },
);
