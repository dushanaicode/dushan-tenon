import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { currentUser } from "@/core/core.test-support";
import type { FileTextPageInput } from "@/lib/generated/FileTextPageInput";
import { fixture, mockFilesIpc, renderFiles, row } from "./files.test-support";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.slot === "virtual-list"
        ? 320
        : this.hasAttribute("data-virtual-index")
          ? 28
          : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    () => 540,
  );
});
afterEach(() => vi.restoreAllMocks());

test("文本预览按块显示原文与范围，关闭对话框", async () => {
  const calls = fixture();
  await screen.findByText("说明.txt");
  const trigger = screen.getByRole("button", { name: "预览" });
  trigger.focus();
  fireEvent.click(trigger);
  const element = await screen.findByRole("dialog", { name: "预览" });
  expect(element.dataset.slot).toBe("dialog-content");
  const dialog = within(element);
  expect(await dialog.findByText("文本内容")).toBeTruthy();
  expect(dialog.getByText("字节 1–12 / 12")).toBeTruthy();
  expect(calls).toHaveBeenCalledWith("files_file_text_page", {
    input: { id: row.id, offset: 0, fingerprint: null },
  });
  fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("文本翻块携带指纹，上一块重读而不累积正文", async () => {
  const calls = fixture({ pages: true });
  fireEvent.click(await screen.findByRole("button", { name: "预览" }));
  const dialog = within(await screen.findByRole("dialog", { name: "预览" }));
  await dialog.findByText("文本内容");
  fireEvent.click(dialog.getByRole("button", { name: "下一块" }));
  await dialog.findByText("nextpart");
  expect(dialog.queryByText("文本内容")).toBeNull();
  expect(calls).toHaveBeenCalledWith("files_file_text_page", {
    input: { id: row.id, offset: 12, fingerprint: "b".repeat(64) },
  });
  expect(
    (dialog.getByRole("button", { name: "下一块" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "上一块" }));
  await dialog.findByText("文本内容");
  expect(dialog.queryByText("nextpart")).toBeNull();
  expect(calls).toHaveBeenCalledWith("files_file_text_page", {
    input: { id: row.id, offset: 0, fingerprint: "b".repeat(64) },
  });
});

test("图片在预览对话框显示 data URL", async () => {
  const url = "data:image/png;base64,iVBORw0KGgo=";
  fixture({
    file: { ...row, extension: "png", originalName: "图片.png" },
    preview: { type: "image", mime: "image/png", dataUrl: url },
  });
  await screen.findByText("图片.png");
  fireEvent.click(screen.getByRole("button", { name: "预览" }));
  const image = await screen.findByRole("img", { name: "图片.png" });
  expect(image.getAttribute("src")).toBe(url);
  expect(screen.getByRole("dialog", { name: "预览" }).contains(image)).toBe(
    true,
  );
});

test.each(["pdf", "xlsx"])(
  "%s 提示另存为，无应用内预览请求",
  async (extension) => {
    const calls = fixture({
      file: { ...row, extension, originalName: `文件.${extension}` },
    });
    await screen.findByText(`文件.${extension}`);
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(
      await screen.findByText("PDF 和 XLSX 不支持应用内预览，请另存为后查看。"),
    ).toBeTruthy();
    expect(
      calls.mock.calls.some(([name]) => name === "files_file_preview"),
    ).toBe(false);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "另存为",
      }),
    ).toBeTruthy();
  },
);

test("翻块和关闭后只保留当前文本块缓存，正文作为纯文本显示", async () => {
  mockFilesIpc({
    pages: true,
    preview: {
      type: "text",
      text: "<script>private-body</script>",
      truncated: false,
    },
  });
  const f = renderFiles();
  fireEvent.click(await screen.findByRole("button", { name: "预览" }));
  await screen.findByText("<script>private-body</script>");
  expect(screen.getByRole("dialog").querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一块" }));
  await screen.findByText("nextpart");
  const key = ["files", currentUser.id, "text-page"];
  await waitFor(() =>
    expect(f.client.getQueryCache().findAll({ queryKey: key })).toHaveLength(1),
  );
  expect(
    f.client.getQueryCache().findAll({ queryKey: key })[0].state.data,
  ).toMatchObject({ text: "nextpart" });
  expect(screen.queryByText("<script>private-body</script>")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(f.client.getQueryCache().findAll({ queryKey: key })).toHaveLength(0),
  );
});

test("空文件显示零字节范围并禁用前后翻块", async () => {
  fixture({ preview: { type: "text", text: "", truncated: false } });
  fireEvent.click(await screen.findByRole("button", { name: "预览" }));
  await screen.findByText("字节 0–0 / 0");
  expect(screen.getByRole("button", { name: "上一块" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "下一块" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("分块读取失败时不显示旧正文，重新从头读取清除指纹和历史", async () => {
  let restarted = false;
  const calls = fixture({ pages: true }, (command, payload) => {
    if (command !== "files_file_text_page") return;
    const { input } = payload as { input: FileTextPageInput };
    if (input.offset > 0) {
      restarted = true;
      return Promise.reject({
        code: "app.data.version_conflict",
        params: {},
        traceId: "changed-file",
      });
    }
    if (restarted)
      return {
        text: "新的正文",
        offset: 0,
        nextOffset: null,
        totalBytes: 12,
        fingerprint: "c".repeat(64),
      };
  });
  fireEvent.click(await screen.findByRole("button", { name: "预览" }));
  await screen.findByText("文本内容");
  fireEvent.click(screen.getByRole("button", { name: "下一块" }));
  await screen.findByText("记录已被修改，请刷新后重试。");
  expect(screen.queryByText("文本内容")).toBeNull();
  expect(screen.getByRole("button", { name: "下一块" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新从头读取" }));
  await screen.findByText("新的正文");
  expect(
    calls.mock.calls
      .filter(([command]) => command === "files_file_text_page")
      .at(-1),
  ).toEqual([
    "files_file_text_page",
    { input: { id: row.id, offset: 0, fingerprint: null } },
  ]);
  expect(screen.getByRole("button", { name: "上一块" })).toHaveProperty(
    "disabled",
    true,
  );
});
