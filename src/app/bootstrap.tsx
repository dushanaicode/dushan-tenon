import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ComponentProps, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { createHashRouter, Outlet, RouterProvider } from "react-router";
import { getSnapshot, useAppearanceSnapshot } from "@/core/appearance-bridge";
import { i18n } from "@/core/i18n";
import { ModuleDirectoryProvider } from "@/core/module-directory";
import { createQueryClient } from "@/core/query-client";
import { Toaster } from "@/kit";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { WindowChromeProvider } from "@/shell";
import { Backdrop } from "@/visual";
import { App } from "./app";
import { manifests } from "./module-registry";
import { RootError } from "./root-error";

export function desktopPlatform(): ComponentProps<
  typeof WindowChromeProvider
>["platform"] {
  const platform = navigator.platform;
  if (/Win/i.test(platform)) return "windows";
  if (/Mac/i.test(platform)) return "macos";
  if (/Linux/i.test(platform)) return "linux";
  throw new Error("Unsupported desktop platform");
}

export function appRoutes(
  settings: AppSettings,
  platform: ReturnType<typeof desktopPlatform>,
) {
  return [
    {
      element: <ApplicationFrame />,
      children: [
        {
          path: "*",
          element: <App platform={platform} />,
          errorElement: (
            <RootError titlebar={settings.titlebar.value} platform={platform} />
          ),
        },
      ],
    },
  ];
}

export function Application({
  client,
  router,
}: {
  client: QueryClient;
  router: ReturnType<typeof createHashRouter>;
}) {
  return (
    <QueryClientProvider client={client}>
      <ModuleDirectoryProvider manifests={manifests}>
        <RouterProvider router={router} />
      </ModuleDirectoryProvider>
    </QueryClientProvider>
  );
}

function ApplicationFrame() {
  const { i18n: translation } = useTranslation();
  const { dark } = useAppearanceSnapshot();
  useEffect(() => {
    document.documentElement.lang = translation.language;
  }, [translation.language]);
  return (
    <>
      <Backdrop />
      <Outlet />
      <Toaster theme={dark ? "dark" : "light"} />
    </>
  );
}

export async function startApp(root: HTMLElement, settings: AppSettings) {
  const platform = desktopPlatform();
  getSnapshot();
  await i18n.changeLanguage(settings.language.value);
  document.documentElement.lang = i18n.language;
  const client = createQueryClient();
  client.setQueryData(["app", "settings"], settings);
  const router = createHashRouter(appRoutes(settings, platform));
  createRoot(root).render(
    <StrictMode>
      <Application client={client} router={router} />
    </StrictMode>,
  );
}
