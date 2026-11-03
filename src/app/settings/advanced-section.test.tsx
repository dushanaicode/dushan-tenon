import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { WORKBENCH_DEFAULTS } from "@/lib/generated/workbench";
import { mockAppIpc, renderApp } from "./settings.test-support";

test("工作台复位等待宿主确认并显示结果", async () => {
  let finish: (snapshot: unknown) => void = () => {
    throw new Error("not started");
  };
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const calls = mockAppIpc((name) =>
    name === "app_workbench_reset_layout" ? pending : undefined,
  );
  renderApp("/settings/advanced");
  fireEvent.click(
    await screen.findByRole("button", { name: "重置当前工作区布局" }),
  );
  const dialog = await screen.findByRole("alertdialog");
  expect(
    calls.mock.calls.some(([name]) => name === "app_workbench_reset_layout"),
  ).toBe(false);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "重置当前工作区布局" }),
  );
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
  await act(async () => {
    finish({ ...WORKBENCH_DEFAULTS, revision: 1 });
  });
  await screen.findByText("工作区布局已重置");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(calls).toHaveBeenCalledWith("app_workbench_reset_layout", {
    input: { expectedRevision: 0 },
  });
  expect(
    calls.mock.calls.some(([name]) => name === "app_settings_update"),
  ).toBe(false);
});

test("复位冲突保留错误，显式重载后使用新 revision 再复位", async () => {
  let conflicted = false;
  const calls = mockAppIpc((name) => {
    if (name === "app_workbench_get")
      return { ...WORKBENCH_DEFAULTS, revision: conflicted ? 7 : 0 };
    if (name === "app_workbench_reset_layout") {
      if (!conflicted) {
        conflicted = true;
        return Promise.reject({
          code: "app.workbench.conflict",
          params: {},
          traceId: "reset-conflict",
        });
      }
      return { ...WORKBENCH_DEFAULTS, revision: 8 };
    }
    return undefined;
  });
  renderApp("/settings/advanced");
  fireEvent.click(
    await screen.findByRole("button", { name: "重置当前工作区布局" }),
  );
  let dialog = await screen.findByRole("alertdialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "重置当前工作区布局" }),
  );
  await within(dialog).findByText(/reset-conflict/);
  fireEvent.click(within(dialog).getByRole("button", { name: "重新读取布局" }));
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "重置当前工作区布局" }),
    ).toHaveProperty("disabled", false),
  );
  dialog = screen.getByRole("alertdialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "重置当前工作区布局" }),
  );
  await screen.findByText("工作区布局已重置");
  expect(calls).toHaveBeenCalledWith("app_workbench_reset_layout", {
    input: { expectedRevision: 7 },
  });
});

test("复位普通失败可重试且不丢失错误", async () => {
  let fails = true;
  mockAppIpc((name) => {
    if (name !== "app_workbench_reset_layout") return undefined;
    if (fails) {
      fails = false;
      return Promise.reject({
        code: "app.workbench.write_failed",
        params: {},
        traceId: "reset-failed",
      });
    }
    return { ...WORKBENCH_DEFAULTS, revision: 1 };
  });
  renderApp("/settings/advanced");
  fireEvent.click(
    await screen.findByRole("button", { name: "重置当前工作区布局" }),
  );
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "重置当前工作区布局" }),
  );
  await within(dialog).findByText(/reset-failed/);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "重置当前工作区布局" }),
  );
  await screen.findByText("工作区布局已重置");
});
