import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  currentUser,
  mockAppIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { SettingsDraftProvider } from "@/core/settings/drafts";
import { SettingsActionBar } from "@/core/settings/settings-action-bar";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import { PERMISSION_KEYS } from "@/lib/generated/permissions";
import { AuthGate } from "./auth-gate";
import { ProfilePage } from "./profile-page";
import { SecuritySettings } from "./security-settings";
import { SessionActions } from "./session-actions";

export const codes = Array.from(
  { length: 10 },
  (_, index) => `000${index}-ABCD-EFGH-JKMP`,
);

export function mockAuth(
  state: AuthStatus["state"],
  mode: AuthStatus["mode"] = "login",
  override?: (command: string) => unknown,
) {
  const status: AuthStatus = {
    state,
    mode,
    user:
      state === "anonymous" ||
      state === "initRequired" ||
      state === "confirmRequired"
        ? null
        : { ...currentUser, mode },
    idleLockMinutes: 1,
    permissions:
      state === "active" || state === "locked" ? [...PERMISSION_KEYS] : [],
  };
  let challenge = 0;
  const calls = mockAppIpc((command) => {
    const result = override?.(command);
    if (result !== undefined) return result;
    switch (command) {
      case "account_auth_status":
        return {
          ...structuredClone(status),
          permissions: status.user ? [...PERMISSION_KEYS] : [],
        };
      case "account_user_me":
        return { ...currentUser, mode: status.mode };
      case "account_auth_login":
      case "account_session_unlock":
        status.state = "active";
        status.user = { ...currentUser, mode: status.mode };
        return null;
      case "account_auth_captcha":
        challenge += 1;
        return {
          id: `captcha-${challenge}`,
          image: `data:image/png;base64,image-${challenge}`,
        };
      case "account_auth_recover":
        status.state = "active";
        status.user = { ...currentUser, mode: "login" };
        return { remainingCodes: 9 };
      case "account_auth_recovery_remaining":
        return { remaining: 10 };
      case "account_auth_recovery_regenerate":
        return { recoveryCodes: codes };
      case "account_auth_logout":
        status.state = "anonymous";
        status.user = null;
        return null;
      case "account_session_lock":
        status.state = "locked";
        return null;
      case "account_session_touch":
        return null;
      case "account_auth_initialize":
      case "account_auth_enable_login":
        status.state = "active";
        status.mode = "login";
        status.user = { ...currentUser, mode: "login" };
        return { recoveryCodes: codes };
      case "account_auth_confirm_mode":
      case "account_auth_disable_login":
        status.state = "active";
        status.mode = "none";
        status.user = { ...currentUser };
        return null;
    }
  });
  return { status, calls };
}

export function fillPassword(confirm = false) {
  fireEvent.change(screen.getAllByLabelText("密码")[0], {
    target: { value: "test-password" },
  });
  if (confirm)
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "test-password" },
    });
}

export function renderAccount(page = "/", content?: ReactNode) {
  const { client, wrapper } = queryWrapper();
  const body =
    page === "/settings/security" ? (
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: page,
              element: (
                <EditSessionsProvider>
                  <SettingsDraftProvider>
                    {content ?? <SecuritySettings />}
                    <SettingsActionBar />
                  </SettingsDraftProvider>
                </EditSessionsProvider>
              ),
            },
          ],
          { initialEntries: [page] },
        )}
      />
    ) : (
      (content ??
      (page === "/account/profile" ? <ProfilePage /> : <p>账户内容</p>))
    );
  return {
    client,
    ...render(
      <AuthGate header={<header>公开偏好</header>}>
        <nav aria-label="受保护内容" />
        <SessionActions />
        <button type="button">受保护操作</button>
        {body}
      </AuthGate>,
      { wrapper },
    ),
  };
}
