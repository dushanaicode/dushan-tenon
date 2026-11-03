import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import {
  currentUser,
  mockAppIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { UserMenu } from "./user-menu";

it("账户由 props 注入；本机模式没有会话动作，语言通过同一设置 mutation 保存", async () => {
  const calls = mockAppIpc();
  render(
    <MemoryRouter>
      <UserMenu
        user={{ ...currentUser, displayName: "测试账户" }}
        profilePath="/account/profile"
      />
    </MemoryRouter>,
    { wrapper: queryWrapper().wrapper },
  );
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: "测试账户" }),
    { button: 0, ctrlKey: false },
  );
  expect(
    await screen.findByRole("menuitem", { name: /个人资料/ }),
  ).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /锁定/ })).toBeNull();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "English" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_settings_update", {
      input: { language: "en-US" },
    }),
  );
});
it("登录模式显示锁定与退出，缺少 profilePath 时不提供资料路由", async () => {
  mockAppIpc();
  render(
    <MemoryRouter>
      <UserMenu
        user={{ ...currentUser, displayName: "登录账户", mode: "login" }}
      />
    </MemoryRouter>,
    { wrapper: queryWrapper().wrapper },
  );
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: "登录账户" }),
    { button: 0, ctrlKey: false },
  );
  expect(await screen.findByRole("menuitem", { name: /锁定/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /退出/ })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /个人资料/ })).toBeNull();
});
