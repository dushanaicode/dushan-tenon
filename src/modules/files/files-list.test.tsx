import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { fixture, row, selectValue } from "./files.test-support";

test("本机文件列表、状态、用途与关键字筛选、分页", async () => {
  const calls = fixture({
    file: { ...row, missing: true },
    total: 21,
  });
  await screen.findByText("说明.txt");
  expect(
    screen
      .getByRole("table", { name: "文件管理" })
      .closest('[data-slot="table-container"]'),
  ).not.toBeNull();
  expect(screen.getByText("文件缺失").className).toContain("bg-warning-soft");
  expect(screen.queryByRole("columnheader", { name: "上传者" })).toBeNull();
  expect(screen.queryByText("owner-id")).toBeNull();
  expect(screen.getByText("2.0 KiB")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("files_file_list", {
      input: { page: 2, pageSize: 20, purpose: undefined, keyword: undefined },
    }),
  );
  await selectValue("用途", "附件");
  fireEvent.change(screen.getByRole("textbox", { name: "文件名关键字" }), {
    target: { value: "说明%" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("files_file_list", {
      input: {
        page: 1,
        pageSize: 20,
        purpose: "files.attachment",
        keyword: "说明%",
      },
    }),
  );
  expect(
    (screen.getByRole("textbox").closest("form") as HTMLFormElement).noValidate,
  ).toBe(true);
});

test("只有读取权限时仍可预览和另存，隐藏添加、删除、回收", async () => {
  fixture({ writable: false });
  await screen.findByText("说明.txt");
  for (const name of ["添加文件", "删除", "回收"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.getByRole("button", { name: "预览" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "另存为" })).toBeTruthy();
});

test("列表错误按 IPC 文案显示", async () => {
  fixture({ error: true });
  expect(await screen.findByText("本机文件已缺失。")).toBeTruthy();
});
