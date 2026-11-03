import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { mockAppIpc, queryWrapper } from "@/core/core.test-support";
import { accountManifest } from "./manifest";

test("清单提供无额外权限的资料路由和安全分节，工厂加载实际界面", async () => {
  expect(accountManifest.id).toBe("account");
  expect(accountManifest.basePath).toBe("/account");
  expect(accountManifest.nav).toEqual([]);
  expect(accountManifest.devPages).toEqual([]);
  expect(accountManifest.headerWidgets).toEqual([]);
  expect(accountManifest.routes).toHaveLength(1);
  const route = accountManifest.routes[0];
  expect(route.path).toBe("/account/profile");
  expect(route).not.toHaveProperty("permission");
  expect(accountManifest.settings).toHaveLength(1);
  const setting = accountManifest.settings[0];
  expect(setting).toMatchObject({
    id: "security",
    labelKey: "account.settings.title",
    order: 40,
  });
  mockAppIpc();
  const { wrapper } = queryWrapper();
  const { default: Profile } = await route.Component();
  const profile = render(<Profile />, { wrapper });
  await screen.findByRole("heading", { name: "个人设置" });
  profile.unmount();
  const { default: Security } = await setting.Component();
  render(<Security />, { wrapper });
  await screen.findByRole("region", { name: "安全" });
}, 20_000);
