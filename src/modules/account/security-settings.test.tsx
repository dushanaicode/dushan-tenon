import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import { mockAppIpc } from "@/core/core.test-support";
import {
  codes,
  fillPassword,
  mockAuth,
  renderAccount,
} from "./account.test-support";

test("设置页显示剩余数量，重新生成后仅展示新恢复码", async () => {
  const { calls } = mockAuth("active");
  renderAccount("/settings/security");
  await screen.findByText("剩余恢复码：10 个");
  const button = screen.getByRole("button", { name: "重新生成恢复码" });
  const form = within(button.closest("form") as HTMLFormElement);
  fireEvent.change(form.getByLabelText("密码"), {
    target: { value: "test-password" },
  });
  fireEvent.click(button);
  await screen.findByRole("heading", { name: "保存恢复码" });
  expect(calls).toHaveBeenCalledWith("account_auth_recovery_regenerate", {
    input: { password: "test-password" },
  });
  for (const code of codes) expect(screen.getByText(code)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "我已保存" }));
  await screen.findByRole("button", { name: "重新生成恢复码" });
  expect(screen.queryByText(codes[0])).toBeNull();
});

test.each([
  ["", ""],
  ["test-password", ""],
  ["", "test-password"],
])(
  "启用登录缺少必填项时提示且不调用命令（用例 %#）",
  async (password, confirm) => {
    const { calls } = mockAuth("active", "none");
    renderAccount("/settings/security");
    await screen.findByRole("region", { name: "安全" });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: password },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: confirm },
    });
    fireEvent.click(screen.getByRole("button", { name: "启用登录" }));
    expect(screen.getByRole("alert").textContent).toBe("请填写所有字段。");
    expect(
      calls.mock.calls.some(
        ([command]) => command === "account_auth_enable_login",
      ),
    ).toBe(false);
  },
);

test("设置页启用登录后保留恢复码并启动会话控件", async () => {
  mockAuth("active", "none");
  renderAccount("/settings/security");
  await screen.findByRole("region", { name: "安全" });
  fillPassword(true);
  fireEvent.click(screen.getByRole("button", { name: "启用登录" }));
  await screen.findByRole("heading", { name: "保存恢复码" });
  expect(screen.getByRole("button", { name: "锁定" })).toBeTruthy();
  for (const code of codes) expect(screen.getByText(code)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "我已保存" }));
  await screen.findByRole("button", { name: "关闭登录" });
  fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "关闭登录" }));
  await screen.findByRole("button", { name: "启用登录" });
});

test("安全分节编辑自动锁定时长，通过统一操作栏保存并刷新认证时限", async () => {
  const calls = mockAppIpc();
  const { client } = renderAccount("/settings/security");
  const security = within(await screen.findByRole("region", { name: "安全" }));
  const editor = await security.findByRole("textbox", {
    name: "空闲自动锁定（分钟）",
  });
  expect(editor).toHaveProperty("value", "15");
  expect(security.getByText(/登录模式下生效/)).toBeTruthy();
  expect(calls).toHaveBeenCalledWith("app_setting_list", {
    input: { includeDisabled: false },
  });
  fireEvent.change(editor, { target: { value: "21" } });
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await waitFor(() =>
    expect(client.getQueryData(authKey)).toMatchObject({ idleLockMinutes: 21 }),
  );
  expect(editor).toHaveProperty("value", "21");
  expect(calls).toHaveBeenCalledWith("app_setting_set", {
    input: { key: "account.idle_lock_minutes", value: "21", rowVersion: null },
  });
});
