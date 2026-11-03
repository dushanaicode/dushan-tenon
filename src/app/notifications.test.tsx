import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { activeAuth, appModules, currentUser } from "@/core/core.test-support";
import { toast } from "@/kit";
import { item } from "@/modules/notify/notifications.test-support";
import { mockAppIpc, renderApp } from "./app.test-support";

test.each(["disabled", "locked"] as const)(
  "通知 %s 后卸载铃铛、查询订阅和已显示 toast",
  async (kind) => {
    const dismiss = vi.spyOn(toast, "dismiss");
    mockAppIpc();
    const { client } = renderApp();
    await screen.findByRole("button", { name: "通知" });
    await waitFor(() =>
      expect(
        client.getQueryCache().find({
          queryKey: ["notify", "notifications", currentUser.id, "unread"],
        }),
      ).toBeDefined(),
    );
    // Use the live query key rather than duplicating the module's account scoping.
    const unread = client
      .getQueryCache()
      .findAll()
      .find(
        (query) =>
          query.queryKey[0] === "notify" && query.queryKey.at(-1) === "unread",
      );
    expect(unread).toBeDefined();
    act(() => client.setQueryData(unread?.queryKey ?? [], 1));
    const fresh = {
      ...item,
      id: "integrate-toast",
      createdAt: new Date(Date.now() + 1000).toISOString(),
    };
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll()
          .some(
            (query) =>
              query.queryKey[0] === "notify" && query.queryKey.includes("list"),
          ),
      ).toBe(true),
    );
    act(() => {
      for (const query of client.getQueryCache().findAll()) {
        if (query.queryKey[0] === "notify" && query.queryKey.includes("list"))
          client.setQueryData(query.queryKey, {
            items: [fresh],
            total: 1,
            page: 1,
            pageSize: 5,
          });
      }
    });
    await screen.findByRole("button", { name: "查看" });
    act(() => {
      if (kind === "disabled")
        client.setQueryData(["app", "modules"], {
          modules: appModules.modules.map((module) => ({
            ...module,
            enabled: module.id !== "notify",
          })),
        });
      else
        client.setQueryData(["account", "auth"], {
          ...activeAuth,
          state: "locked",
          mode: "login",
          permissions: [],
        });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "通知" })).toBeNull(),
    );
    await waitFor(() =>
      expect(dismiss).toHaveBeenCalledWith(
        `notify:${currentUser.id}:integrate-toast`,
      ),
    );
    expect(unread?.getObserversCount()).toBe(0);
  },
);

test("通知入口使用真实清单路由", async () => {
  mockAppIpc();
  const { router } = renderApp();
  fireEvent.click(await screen.findByRole("button", { name: "通知" }));
  fireEvent.click(await screen.findByRole("link", { name: "查看全部" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/notify"));
  expect(await screen.findByRole("heading", { name: "通知中心" })).toBeTruthy();
});
