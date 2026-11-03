import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { useAuthStatus } from "@/core/auth";
import type { ModuleManifest } from "@/core/contracts/module";
import {
  appModules,
  mockAppIpc as mockCoreIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { IpcErrorMessage } from "@/core/ipc-error";
import { ModuleDirectoryProvider } from "@/core/module-directory";
import { SettingsDraftProvider } from "@/core/settings/drafts";
import type { AppAbout } from "@/lib/generated/AppAbout";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { NativeSettings } from "@/lib/generated/NativeSettings";
import type { NativeSettingsChange } from "@/lib/generated/NativeSettingsChange";
import type { NetworkSettings } from "@/lib/generated/NetworkSettings";
import type { NetworkSettingsUpdate } from "@/lib/generated/NetworkSettingsUpdate";
import type { WorkbenchSnapshot } from "@/lib/generated/WorkbenchSnapshot";
import { WORKBENCH_DEFAULTS } from "@/lib/generated/workbench";
import { Shell, WindowChromeProvider } from "@/shell";
import { Settings } from "../settings";
import { NativeSettings as NativeSettingsView } from "./native-settings";
import { useSectionDirectory } from "./sections";

export {
  appModules,
  currentUser,
  defaultSettings,
  paramEntries,
} from "@/core/core.test-support";
export const defaultNativeSettings: NativeSettings = {
  updater: {
    checkOnStart: { value: false, source: "default" },
    configured: false,
  },
  canEdit: true,
  tray: {
    enabled: { value: false, source: "default" },
    closeAction: { value: "exit", source: "default" },
    state: "disabled",
    error: null,
  },
  autostart: {
    desired: { value: false, source: "default" },
    registered: { status: "unsupported", reason: "explicitStateRoot" },
    approval: "unknown",
    approvalError: null,
    effectiveStartup: "unknown",
    state: "unsupported",
    error: null,
  },
  shortcut: {
    desired: { value: "", source: "default" },
    active: null,
    registered: [],
    state: "disabled",
    error: null,
  },
  window: {
    restoreState: { value: true, source: "default" },
    state: "firstRun",
    error: null,
  },
};

export const defaultNetworkSettings: NetworkSettings = {
  mode: { value: "direct", source: "default" },
  endpoint: { value: "", source: "default" },
  auth: { value: false, source: "default" },
  credentialsSet: false,
  credentialSource: "none",
};

export const about = {
  version: "0.1.0-test",
  stateRoot: "E:/isolated/state",
  configFile: "E:/isolated/state/config.toml",
  configFileExists: false,
  logDirectory: "E:/isolated/state/logs",
  databaseKind: "sqlite",
  databaseLocation: "E:/isolated/state/data/app.db",
  appliedMigrations: 3,
  cacheProvider: "local",
  cacheLocation: null,
  cacheStatus: { status: "connected" },
} satisfies AppAbout;

export function mockAppIpc(
  override?: Parameters<typeof mockCoreIpc>[0],
  settingsPatch: Partial<AppSettings> = {},
) {
  const nativeSettings = structuredClone(defaultNativeSettings);
  const networkSettings = structuredClone(defaultNetworkSettings);
  let workbench: WorkbenchSnapshot = structuredClone({
    ...WORKBENCH_DEFAULTS,
    objects: [],
  });
  return mockCoreIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    switch (command) {
      case "app_network_settings_get":
        return structuredClone(networkSettings);
      case "app_network_settings_update": {
        const { input } = payload as { input: NetworkSettingsUpdate };
        networkSettings.mode = { value: input.mode, source: "file" };
        networkSettings.endpoint = { value: input.endpoint, source: "file" };
        networkSettings.auth = { value: input.auth, source: "file" };
        if (input.credentials.type !== "keep") {
          networkSettings.credentialsSet = input.credentials.type === "replace";
          networkSettings.credentialSource = networkSettings.credentialsSet
            ? "credentialStore"
            : "none";
        }
        return structuredClone(networkSettings);
      }
      case "app_native_settings_get":
        return structuredClone(nativeSettings);
      case "app_native_settings_update": {
        const { input } = payload as { input: NativeSettingsChange };
        if (input.type === "window") {
          nativeSettings.window = {
            ...nativeSettings.window,
            restoreState: { value: input.restoreState, source: "file" },
            state: input.restoreState ? "firstRun" : "disabled",
          };
        } else if (input.type === "tray") {
          nativeSettings.tray = {
            enabled: { value: input.enabled, source: "file" },
            closeAction: { value: input.closeAction, source: "file" },
            state: input.enabled ? "ready" : "disabled",
            error: null,
          };
        } else if (input.type === "autostart") {
          nativeSettings.autostart = {
            desired: { value: input.enabled, source: "file" },
            registered: { status: "known", value: input.enabled },
            approval: "allowed",
            approvalError: null,
            effectiveStartup: input.enabled ? "enabled" : "disabled",
            state: "ready",
            error: null,
          };
        } else if (input.type === "updater") {
          nativeSettings.updater.checkOnStart = {
            value: input.checkOnStart,
            source: "file",
          };
        } else {
          nativeSettings.shortcut = {
            desired: { value: input.binding, source: "file" },
            active: input.binding || null,
            registered: input.binding ? [input.binding] : [],
            state: input.binding ? "ready" : "disabled",
            error: null,
          };
        }
        return structuredClone(nativeSettings);
      }
      case "app_window_state_reset":
        nativeSettings.window.state = "restored";
        nativeSettings.window.error = null;
        return structuredClone(nativeSettings);

      case "app_about_get":
        return about;
      case "app_update_status":
        return { status: "unconfigured" };
      case "app_window_watch":
      case "app_stream_cancel":
        return null;
      case "app_workbench_get":
        return workbench;
      case "app_workbench_reset_layout": {
        workbench = { ...workbench, revision: workbench.revision + 1 };
        return workbench;
      }
      case "app_data_status":
        return {
          canManage: true,
          availability: "sqlite",
          operation: null,
          lastRestore: null,
        };
    }
    return undefined;
  }, settingsPatch);
}

function Session({ auth, userId }: { auth: AuthStatus; userId: string }) {
  const directory = useSectionDirectory(auth, userId);
  return (
    <SettingsDraftProvider>
      <Shell
        userId={userId}
        manifests={[]}
        enabled={new Set(appModules.modules.map((m) => m.id))}
        auth={{
          authenticated: true,
          mode: auth.mode,
          developerMode: false,
          permissions: auth.permissions,
        }}
        tree={{ groups: [], footer: [] }}
        sections={directory.status === "success" ? directory.table.visible : []}
        slots={{ brand: "Tenon", headerEnd: null }}
      >
        <Settings directory={directory} />
      </Shell>
    </SettingsDraftProvider>
  );
}
function Scope() {
  const auth = useAuthStatus();
  if (auth.isError && auth.error.code !== "app.operation.busy")
    return <IpcErrorMessage error={auth.error} />;
  if (!auth.data) return null;
  if (auth.data.state !== "active") return <p>已锁定</p>;
  if (!auth.data.user) throw new Error("Active test identity requires a user");
  return <Session auth={auth.data} userId={auth.data.user.id} />;
}
export function renderApp(
  path = "/settings/general",
  manifests: readonly ModuleManifest[] = [],
) {
  const { client } = queryWrapper();
  const router = createMemoryRouter(
    [
      {
        element: (
          <EditSessionsProvider>
            <nav aria-label="主导航">
              <Link to="/">首页</Link>
            </nav>
            <Outlet />
          </EditSessionsProvider>
        ),
        children: [
          { path: "/settings/:section?", element: <Scope /> },
          { path: "/", element: <p>首页内容</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <ModuleDirectoryProvider manifests={manifests}>
        <WindowChromeProvider platform="windows" titlebar="native">
          <RouterProvider router={router} />
        </WindowChromeProvider>
      </ModuleDirectoryProvider>
    </QueryClientProvider>,
  );
  return { ...view, client, router };
}
export function renderNative(
  platform: "windows" | "macos" | "linux" = "windows",
) {
  const { wrapper: Wrapper } = queryWrapper();
  return render(
    <Wrapper>
      <WindowChromeProvider platform={platform} titlebar="native">
        <NativeSettingsView />
      </WindowChromeProvider>
    </Wrapper>,
  );
}
export function renderSetting(children: ReactNode) {
  const { wrapper: Wrapper, client } = queryWrapper();
  return { client, ...render(<Wrapper>{children}</Wrapper>) };
}
