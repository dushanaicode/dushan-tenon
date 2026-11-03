import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { expect, test, vi } from "vitest";
import { send, setupExchange } from "./exchange.test-support";
import { ImportDialog } from "./import-dialog";

function renderImport(patch: Partial<Parameters<typeof ImportDialog>[0]> = {}) {
  const submit = vi.fn().mockResolvedValue({ jobId: "job" }),
    complete = vi.fn();
  render(
    <ImportDialog
      modes={["error", "skip"]}
      suggestedName="rows"
      columnLabel={(column) => `字段 · ${column}`}
      onSubmit={submit}
      onComplete={complete}
      {...patch}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "导入" }));
  return {
    dialog: within(screen.getByRole("dialog", { name: "导入" })),
    submit,
    complete,
  };
}

test("import without a template uses my job and caller column labels in the report", async () => {
  const { state } = setupExchange();
  const submit = vi.fn().mockResolvedValue({ jobId: "job" }),
    complete = vi.fn();
  function Consumer() {
    const { t } = useTranslation();
    const columnLabel = useCallback(
      (column: string) => `${t("files.title")} · ${column}`,
      [t],
    );
    return (
      <ImportDialog
        modes={["error", "skip"]}
        suggestedName="rows"
        columnLabel={columnLabel}
        onSubmit={submit}
        onComplete={complete}
      />
    );
  }
  render(<Consumer />);
  fireEvent.click(screen.getByRole("button", { name: "导入" }));
  const dialog = within(screen.getByRole("dialog", { name: "导入" }));
  expect(dialog.queryByText("模板格式")).toBeNull();
  expect(dialog.queryByRole("button", { name: "下载模板" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "选择导入文件" }));
  await dialog.findByText("rows.csv");
  fireEvent.click(dialog.getByRole("button", { name: "开始导入" }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      "file-token",
      "error",
      expect.any(FormData),
    ),
  );
  state.detail.status = "failed";
  state.detail.result = {
    total: 1,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [
      { row: 2, column: "code", code: "app.exchange.conflict", params: {} },
    ],
    errorsTruncated: true,
  };
  await send(state, {
    type: "failed",
    code: "app.exchange.rows_invalid",
    params: { count: "1" },
  });
  expect(await dialog.findByText("文件管理 · code")).toBeTruthy();
  expect(dialog.getByText("该记录已存在。")).toBeTruthy();
  expect(dialog.getByText(/错误超过报告上限/)).toBeTruthy();
  expect(dialog.queryByText("模板已保存")).toBeNull();
  expect(complete).toHaveBeenCalledTimes(1);
});

test("required file and caller validation prevent submission", async () => {
  const { state } = setupExchange();
  const f = renderImport({ validate: () => "exchange.fileRequired" });
  fireEvent.click(f.dialog.getByRole("button", { name: "开始导入" }));
  expect(f.dialog.getByRole("alert").textContent).toBe("请选择导入文件。");
  state.selection = null;
  fireEvent.click(f.dialog.getByRole("button", { name: "选择导入文件" }));
  await waitFor(() =>
    expect(
      f.dialog
        .getByRole("button", { name: "选择导入文件" })
        .closest("fieldset"),
    ).toHaveProperty("disabled", false),
  );
  state.selection = {
    token: "file-token",
    fileName: "rows.csv",
    format: "csv",
  };
  fireEvent.click(f.dialog.getByRole("button", { name: "选择导入文件" }));
  await f.dialog.findByText("rows.csv");
  fireEvent.click(f.dialog.getByRole("button", { name: "开始导入" }));
  expect(f.submit).not.toHaveBeenCalled();
  expect(f.dialog.getByRole("alert")).toBeTruthy();
});

test("claimed files open directly and are consumed after submission", async () => {
  setupExchange();
  const consumed = vi.fn();
  const f = renderImport({
    pickedFile: {
      token: "claim-token",
      fileName: "claimed.json",
      format: "json",
    },
    onPickedConsumed: consumed,
  });
  expect(f.dialog.getByText("claimed.json")).toBeTruthy();
  fireEvent.click(f.dialog.getByRole("button", { name: "开始导入" }));
  await waitFor(() =>
    expect(f.submit).toHaveBeenCalledWith(
      "claim-token",
      "error",
      expect.any(FormData),
    ),
  );
  await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));
  expect(f.dialog.queryByText("claimed.json")).toBeNull();
  expect(f.dialog.getByRole("button", { name: "关闭" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("template download picks an export token without submitting a job", async () => {
  const { calls } = setupExchange();
  const template = vi.fn().mockResolvedValue(null);
  const f = renderImport({ onTemplate: template });
  fireEvent.click(f.dialog.getByRole("button", { name: "下载模板" }));
  await waitFor(() =>
    expect(template).toHaveBeenCalledWith("xlsx", "file-token"),
  );
  expect(calls).toHaveBeenCalledWith("app_file_pick", {
    input: { purpose: "export", format: "xlsx", suggestedName: "rows.xlsx" },
  });
  expect(await f.dialog.findByText("模板已保存")).toBeTruthy();
  expect(f.submit).not.toHaveBeenCalled();
});

test("submission failure displays the IPC error and consumes the one-use token", async () => {
  setupExchange();
  const consumed = vi.fn();
  const f = renderImport({
    pickedFile: { token: "expired", fileName: "rows.csv", format: "csv" },
    onPickedConsumed: consumed,
    onSubmit: vi.fn().mockRejectedValue({
      code: "app.exchange.file_token_invalid",
      params: {},
      traceId: "invalid-file",
    }),
  });
  fireEvent.click(f.dialog.getByRole("button", { name: "开始导入" }));
  expect(
    await f.dialog.findByText("文件选择已失效，请重新选择。"),
  ).toBeTruthy();
  expect(consumed).toHaveBeenCalledTimes(1);
  expect(f.dialog.queryByText("rows.csv")).toBeNull();
});
