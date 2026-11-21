import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import {
  createMemoryRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach } from "vitest";
import { useAuthStatus } from "../auth";
import { EditSessionsProvider } from "../edit-sessions";
import { createQueryClient } from "../query-client";
import "../core.test-support";
import { SettingsDraftProvider } from "./drafts";
import { ParamForm } from "./param-form";
import { SettingsActionBar } from "./settings-action-bar";

function Scope() {
  const auth = useAuthStatus();
  if (auth.data?.state !== "active")
    return <h1>{auth.data?.state === "locked" ? "已锁定" : "登录"}</h1>;
  return (
    <SettingsDraftProvider>
      <Outlet />
    </SettingsDraftProvider>
  );
}
function Settings() {
  const location = useLocation();
  return (
    <>
      <nav aria-label="主导航">
        <Link to="/">首页</Link>
        <Link to="/settings/general">通用</Link>
      </nav>
      {location.pathname === "/settings/general" ? (
        <section aria-label="通用">通用内容</section>
      ) : (
        <ParamForm
          group={
            location.pathname === "/settings/sample"
              ? "sample.work"
              : "account.security"
          }
          includeDisabled={false}
        />
      )}
      <SettingsActionBar />
    </>
  );
}
const clients: ReturnType<typeof createQueryClient>[] = [];
export function renderSettings(path: string) {
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        element: (
          <EditSessionsProvider>
            <Scope />
          </EditSessionsProvider>
        ),
        children: [
          { path: "/settings/*", element: <Settings /> },
          {
            path: "/",
            element: (
              <nav aria-label="主导航">
                <Link to="/settings/general">通用</Link>
              </nav>
            ),
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});
