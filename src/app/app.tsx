import type { ComponentProps } from "react";
import { useAppSettings } from "@/core/app-settings";
import { useAuthStatus } from "@/core/auth";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { useCanOpen, useEnabledModules } from "@/core/enabled-modules";
import { FileIngressButton, FileIngressProvider } from "@/core/file-ingress";
import { IpcErrorMessage } from "@/core/ipc-error";
import { LazyContent, LoadingContent } from "@/core/lazy-content";
import { usePageSessionScope } from "@/core/page-session";
import { SettingsDraftProvider } from "@/core/settings/drafts";
import { evaluateVisibility, type VisibilityAuth } from "@/core/visibility";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import { AuthGate } from "@/modules/account/auth-gate";
import {
  buildNavTree,
  ConnectedWindowControls,
  dragRegion,
  Shell,
  ThemeToggle,
  UserMenu,
  WindowChromeProvider,
} from "@/shell";
import { BrandLogo } from "./brand-logo";
import { manifests } from "./module-registry";
import { AppRoutes } from "./routes";
import { useSectionDirectory } from "./settings/sections";

export function App({
  platform,
}: {
  platform: ComponentProps<typeof WindowChromeProvider>["platform"];
}) {
  const settings = useAppSettings();
  if (settings.isPending) return <LoadingContent />;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const titlebar = settings.data.titlebar.value;
  return (
    <WindowChromeProvider titlebar={titlebar} platform={platform}>
      <AuthGate
        header={
          <header
            {...dragRegion(titlebar)}
            className={`flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border pl-6 ${titlebar === "hidden" ? "pr-0" : "pr-6"}`}
          >
            <BrandLogo />
            <div className="flex h-full shrink-0 items-center gap-3">
              <ThemeToggle />
              <ConnectedWindowControls />
            </div>
          </header>
        }
      >
        <AppShell />
      </AuthGate>
    </WindowChromeProvider>
  );
}

function AppShell() {
  const auth = useAuthStatus();
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  return <ActiveShell auth={auth.data} userId={auth.data.user.id} />;
}

function ActiveShell({ auth, userId }: { auth: AuthStatus; userId: string }) {
  usePageSessionScope(userId);
  const settings = useAppSettings();
  const modules = useEnabledModules();
  const enabled = modules.enabled ?? new Set<string>();
  const directory = useSectionDirectory(auth, userId);
  const profileVisible = useCanOpen("/account/profile");
  const visibility: VisibilityAuth = {
    authenticated: auth.state === "active",
    developerMode: settings.data?.developerMode.value === true,
    mode: auth.mode,
    permissions: auth.permissions,
  };
  return (
    <EditSessionsProvider>
      <SettingsDraftProvider>
        <FileIngressProvider>
          <Shell
            userId={userId}
            manifests={manifests}
            enabled={enabled}
            auth={visibility}
            tree={buildNavTree(manifests, modules.enabled, visibility)}
            sections={
              directory.status === "success" ? directory.table.visible : []
            }
            slots={{
              brand: <BrandLogo />,
              headerEnd: (
                <>
                  <FileIngressButton />
                  <HeaderWidgets enabled={modules.enabled} auth={visibility} />
                  <ThemeToggle />
                  {auth.user && (
                    <UserMenu
                      user={auth.user}
                      profilePath={
                        profileVisible ? "/account/profile" : undefined
                      }
                    />
                  )}
                </>
              ),
            }}
          >
            <AppRoutes directory={directory} />
          </Shell>
        </FileIngressProvider>
      </SettingsDraftProvider>
    </EditSessionsProvider>
  );
}

function HeaderWidgets({
  enabled,
  auth,
}: {
  enabled: ReadonlySet<string> | undefined;
  auth: VisibilityAuth;
}) {
  const widgets = manifests
    .filter((manifest) => enabled?.has(manifest.id))
    .flatMap((manifest) => manifest.headerWidgets)
    .filter((widget) => evaluateVisibility(widget, auth) === "visible")
    .sort(
      (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return widgets.map((widget) => (
    <LazyContent key={widget.id} factory={widget.Component} fallback={null} />
  ));
}
