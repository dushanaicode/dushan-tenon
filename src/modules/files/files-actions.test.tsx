import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { fixture, row, selectValue } from "./files.test-support";

test.each([false, true])(
  "添加前须选用途，传入白名单，取消=%s",
  async (cancel) => {
    const calls = fixture({ cancel });
    await screen.findByText("说明.txt");
    expect(
      (screen.getByRole("button", { name: "添加文件" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await selectValue("用途", "附件");
    fireEvent.click(screen.getByRole("button", { name: "添加文件" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("app_file_pick", {
        input: { purpose: "store", extensions: ["txt", "png", "pdf", "xlsx"] },
      }),
    );
    if (cancel) {
      await waitFor(() =>
        expect(
          (
            screen.getByRole("button", {
              name: "添加文件",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
      expect(calls.mock.calls.some(([name]) => name === "files_file_add")).toBe(
        false,
      );
    } else {
      await screen.findByText("已添加文件。");
      expect(calls).toHaveBeenCalledWith("files_file_add", {
        input: { purpose: "files.attachment", fileToken: "selected-token" },
      });
    }
  },
);

test.each([false, true])("另存为保留名称和扩展名，取消=%s", async (cancel) => {
  const calls = fixture({ cancel });
  await screen.findByText("说明.txt");
  fireEvent.click(screen.getByRole("button", { name: "另存为" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_file_pick", {
      input: {
        purpose: "save",
        extensions: ["txt"],
        suggestedName: "说明.txt",
      },
    }),
  );
  if (cancel) {
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "另存为" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      calls.mock.calls.some(([name]) => name === "files_file_save_copy"),
    ).toBe(false);
  } else {
    await screen.findByText("已另存文件。");
    expect(calls).toHaveBeenCalledWith("files_file_save_copy", {
      input: { id: row.id, fileToken: "selected-token" },
    });
  }
});

test("删除二次确认，关闭不提交，确认携带版本", async () => {
  const calls = fixture();
  await screen.findByText("说明.txt");
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  let dialog = within(await screen.findByRole("dialog", { name: "删除" }));
  expect(dialog.getByText(/确定删除/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
  expect(calls.mock.calls.some(([name]) => name === "files_file_delete")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("button", { name: "确认" }));
  await screen.findByText("已删除文件。");
  expect(calls).toHaveBeenCalledWith("files_file_delete", {
    input: { id: row.id, rowVersion: 3 },
  });
  await screen.findByText("暂无文件");
});

test("回收须确认并显示完整报告", async () => {
  const calls = fixture();
  await screen.findByText("说明.txt");
  fireEvent.click(screen.getByRole("button", { name: "回收" }));
  let dialog = within(await screen.findByRole("dialog", { name: "回收" }));
  expect(dialog.getByText(/将删除没有登记的本机文件/)).toBeTruthy();
  expect(dialog.getByText(/更换实例标识或数据库/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
  expect(calls.mock.calls.some(([name]) => name === "files_file_reclaim")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "回收" }));
  dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("button", { name: "确认" }));
  expect(
    await screen.findByText(
      "已删除孤儿文件 2 个（2.0 KiB），清理临时文件 3 个，缺失记录 4 条，失败 1 个。",
    ),
  ).toBeTruthy();
});

test("删除发生版本冲突时保留错误对话框并刷新文件列表", async () => {
  const calls = fixture({}, (command) =>
    command === "files_file_delete"
      ? Promise.reject({
          code: "app.data.version_conflict",
          params: {},
          traceId: "conflict",
        })
      : undefined,
  );
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await screen.findByText("记录已被修改，请刷新后重试。");
  expect(screen.getByRole("dialog", { name: "删除" })).toBeTruthy();
  expect(screen.queryByText("已删除文件。")).toBeNull();
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([command]) => command === "files_file_list")
        .length,
    ).toBeGreaterThan(1),
  );
});
