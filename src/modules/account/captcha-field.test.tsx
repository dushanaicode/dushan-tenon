import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { fillPassword, mockAuth, renderAccount } from "./account.test-support";

test.each([
  ["anonymous", "account_auth_login", "登录"],
  ["locked", "account_session_unlock", "解锁"],
  ["confirmRequired", "account_auth_confirm_mode", "确认关闭登录"],
  ["active", "account_auth_disable_login", "关闭登录"],
  ["active", "account_auth_recovery_regenerate", "重新生成恢复码"],
] as const)(
  "%s 的 %s 显示验证码、附带答案并在无效后刷新",
  async (state, command, label) => {
    let attempts = 0;
    const { calls } = mockAuth(state, "login", (name) => {
      if (name === command) {
        attempts += 1;
        throw {
          code:
            attempts === 1
              ? "account.auth.captcha_required"
              : "account.auth.captcha_invalid",
          params: {},
          traceId: `attempt-${attempts}`,
        };
      }
    });
    renderAccount(state === "active" ? "/settings/security" : "/");
    const button = await screen.findByRole("button", { name: label });
    const form = within(button.closest("form") as HTMLFormElement);
    fireEvent.change(form.getByLabelText("密码"), {
      target: { value: "test-password" },
    });
    fireEvent.click(button);
    expect(
      (await form.findByRole("img", { name: "登录保护验证码" })).getAttribute(
        "src",
      ),
    ).toContain("image-1");
    const answer = form.getByLabelText("验证码");
    const field = answer.closest('[data-slot="form-field"]');
    expect(field?.classList.contains("gap-2")).toBe(true);
    expect(field?.querySelector("label")?.nextElementSibling).toBe(answer);
    fireEvent.change(form.getByLabelText("验证码"), {
      target: { value: "abcde" },
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(form.getByRole("img").getAttribute("src")).toContain("image-2"),
    );
    expect((form.getByLabelText("验证码") as HTMLInputElement).value).toBe("");
    expect(calls).toHaveBeenCalledWith(command, {
      input: {
        password: "test-password",
        captcha: { id: "captcha-1", answer: "abcde" },
      },
    });
    fireEvent.click(form.getByRole("button", { name: "刷新验证码" }));
    await waitFor(() =>
      expect(form.getByRole("img").getAttribute("src")).toContain("image-3"),
    );
  },
);

test("临时锁定展示服务器给出的剩余分钟数", async () => {
  mockAuth("anonymous", "login", (command) => {
    if (command === "account_auth_login")
      throw {
        code: "account.auth.temporarily_locked",
        params: { minutes: "7" },
        traceId: "limited",
      };
  });
  renderAccount();
  await screen.findByRole("heading", { name: "登录" });
  fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "7 分钟后重试",
  );
});

test("登录凭据无效时仍显示密码提示并保留追踪 ID", async () => {
  mockAuth("anonymous", "login", (command) => {
    if (command === "account_auth_login")
      throw {
        code: "account.auth.invalid_credentials",
        params: {},
        traceId: "login-invalid",
      };
  });
  renderAccount();
  await screen.findByRole("heading", { name: "登录" });
  fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  const alert = within(await screen.findByRole("alert"));
  expect(alert.getByText("密码不正确。")).toBeTruthy();
  expect(screen.queryByText("恢复码不正确或已使用。")).toBeNull();
  expect(alert.getByText("追踪 ID：login-invalid")).toBeTruthy();
});
