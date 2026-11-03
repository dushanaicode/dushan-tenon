import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { currentUser, mockAppIpc } from "@/core/core.test-support";
import zhCN from "@/core/i18n/zh-CN.json";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import { renderAccount } from "./account.test-support";

test("所有者更新显示名后刷新个人资料", async () => {
  const user = { ...currentUser };
  const calls = mockAppIpc((name, payload) => {
    if (name === "account_auth_status")
      return {
        mode: "none",
        state: "active",
        user,
        permissions: [],
        idleLockMinutes: 15,
      };
    if (name === "account_user_me") return { ...user };
    if (name === "account_user_profile_update") {
      user.displayName = (
        payload as { input: { displayName: string } }
      ).input.displayName;
      return null;
    }
  });
  renderAccount("/account/profile");
  expect(await screen.findByRole("heading", { name: "个人设置" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "修改密码" })).toBeNull();
  expect(
    screen.getByRole("heading", { name: zhCN["account.profile.editName"] }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText(zhCN["account.profile.displayName"]), {
    target: { value: "新名字" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: zhCN["account.profile.save"] }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("显示名")).toHaveProperty("value", "新名字"),
  );
  expect(await screen.findByText("显示名已保存。")).toBeTruthy();
  expect(calls).toHaveBeenCalledWith("account_user_profile_update", {
    input: { displayName: "新名字" },
  });
});

test("个人改密校验确认密码，出现验证码后重试并保持当前会话", async () => {
  let attempts = 0;
  const user = { ...currentUser, mode: "login" as const };
  const calls = mockAppIpc((name) => {
    if (name === "account_auth_status")
      return {
        mode: "login",
        state: "active",
        user,
        permissions: [],
        idleLockMinutes: 15,
      };
    if (name === "account_user_me") return user;
    if (name === "account_auth_captcha")
      return { id: "challenge", image: "data:image/png;base64,AA==" };
    if (name === "account_user_password_change") {
      attempts += 1;
      if (attempts === 1)
        throw {
          code: "account.auth.captcha_required",
          params: {},
          traceId: "captcha",
        };
      return null;
    }
  });
  renderAccount("/account/profile");
  await screen.findByRole("heading", { name: "个人设置" });
  for (const [label, value] of [
    ["当前密码", "old-password"],
    ["新密码", "new-password"],
    ["确认新密码", "mismatch"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
  expect(await screen.findByText("两次输入的密码不一致。")).toBeTruthy();
  expect(attempts).toBe(0);
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "new-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
  await screen.findByRole("img", { name: "登录保护验证码" });
  fireEvent.change(screen.getByLabelText("验证码"), {
    target: { value: "ABCD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
  expect(
    await screen.findByText("密码已修改，当前窗口仍保持登录。"),
  ).toBeTruthy();
  expect(calls).toHaveBeenCalledWith("account_user_password_change", {
    input: {
      currentPassword: "old-password",
      newPassword: "new-password",
      captcha: { id: "challenge", answer: "ABCD" },
    },
  });
  expect((screen.getByLabelText("当前密码") as HTMLInputElement).value).toBe(
    "",
  );
});

test.each([
  ["显示所有者", "显示所有者"],
  ["", "本机所有者"],
  ["昵称", "昵称"],
] as const)(
  "锁屏显示名与所有者后备名称 display=%s",
  async (displayName, expected) => {
    const user = {
      ...currentUser,
      displayName,
      mode: "login" as const,
    };
    const status: AuthStatus = {
      mode: "login",
      state: "active",
      user,
      permissions: [],
      idleLockMinutes: 15,
    };
    mockAppIpc((name) => {
      if (name === "account_auth_status") return { ...status };
      if (name === "account_user_me") return user;
      if (name === "account_session_lock") {
        status.state = "locked";
        return null;
      }
    });
    renderAccount();
    fireEvent.click(await screen.findByRole("button", { name: "锁定" }));
    await screen.findByRole("heading", { name: "已锁定" });
    expect(within(screen.getByRole("main")).getByText(expected)).toBeTruthy();
  },
);
