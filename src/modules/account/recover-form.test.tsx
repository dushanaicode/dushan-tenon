import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { codes, mockAuth, renderAccount } from "./account.test-support";

test("恢复码无效时显示恢复码提示并保留追踪 ID", async () => {
  mockAuth("anonymous", "login", (command) => {
    if (command === "account_auth_recover")
      throw {
        code: "account.auth.invalid_credentials",
        params: {},
        traceId: "recover-invalid",
      };
  });
  renderAccount();
  fireEvent.click(await screen.findByRole("button", { name: "忘记密码？" }));
  for (const [label, value] of [
    ["恢复码", codes[0]],
    ["新密码", "new-password"],
    ["确认新密码", "new-password"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
  const alert = within(await screen.findByRole("alert"));
  expect(alert.getByText("恢复码不正确或已使用。")).toBeTruthy();
  expect(screen.queryByText("密码不正确。")).toBeNull();
  expect(alert.getByText("追踪 ID：recover-invalid")).toBeTruthy();
});

test("恢复表单校验、验证码及重置成功确认后进入", async () => {
  let attempts = 0;
  const { calls } = mockAuth("anonymous", "login", (command) => {
    if (command === "account_auth_recover" && attempts++ === 0)
      throw {
        code: "account.auth.captcha_required",
        params: {},
        traceId: "recover-captcha",
      };
  });
  renderAccount();
  fireEvent.click(await screen.findByRole("button", { name: "忘记密码？" }));
  expect(screen.queryByLabelText("用户名")).toBeNull();
  for (const label of ["恢复码", "新密码", "确认新密码"]) {
    const input = screen.getByLabelText(label);
    const field = input.closest('[data-slot="form-field"]');
    expect(field?.classList.contains("gap-2")).toBe(true);
    expect(field?.querySelector("label")?.nextElementSibling).toBe(input);
  }
  expect(
    Array.from(
      screen.getByRole("main").querySelectorAll("input"),
      (input) => input.name,
    ),
  ).toEqual(["recoveryCode", "password", "confirm"]);
  fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
  expect(screen.getByRole("alert").textContent).toContain("请填写所有字段");
  for (const [label, value] of [
    ["恢复码", codes[0]],
    ["新密码", "new-password"],
    ["确认新密码", "different"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "两次输入的密码不一致",
  );
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "new-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
  await screen.findByRole("img", { name: "登录保护验证码" });
  expect(calls).toHaveBeenCalledWith("account_auth_recover", {
    input: { recoveryCode: codes[0], newPassword: "new-password" },
  });
  fireEvent.change(screen.getByLabelText("验证码"), {
    target: { value: "ABCDE" },
  });
  const statusCalls = calls.mock.calls.filter(
    ([command]) => command === "account_auth_status",
  ).length;
  fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
  await screen.findByText("密码已重置，剩余恢复码 9 个。");
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(
    calls.mock.calls.filter(([command]) => command === "account_auth_status"),
  ).toHaveLength(statusCalls);
  expect(calls).toHaveBeenCalledWith("account_auth_recover", {
    input: {
      recoveryCode: codes[0],
      newPassword: "new-password",
      captcha: { id: "captcha-1", answer: "ABCDE" },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "进入" }));
  await screen.findByRole("navigation");
});
