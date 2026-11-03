import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach } from "vitest";
import type { AppModules } from "@/lib/generated/AppModules";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { AppSettingsUpdate } from "@/lib/generated/AppSettingsUpdate";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { CurrentUser } from "@/lib/generated/CurrentUser";
import type { KeyboardSettings } from "@/lib/generated/KeyboardSettings";
import type { KeyboardUpdate } from "@/lib/generated/KeyboardUpdate";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { MODULE_IDS, PERMISSION_KEYS } from "@/lib/generated/permissions";
import type { SettingResetInput } from "@/lib/generated/SettingResetInput";
import type { SettingSetInput } from "@/lib/generated/SettingSetInput";
import { mockIpc } from "@/lib/ipc/ipc.test-support";
import { installAppearanceStub } from "./appearance-bridge.test-support";
import { i18n } from "./i18n";
import { createQueryClient } from "./query-client";

export const currentUser: CurrentUser = {
  id: "01999000-1234-7000-8000-123456789abc",
  displayName: "",
  mode: "none",
};
export const activeAuth: AuthStatus = {
  state: "active",
  mode: "none",
  user: currentUser,
  permissions: [...PERMISSION_KEYS],
  idleLockMinutes: 15,
};
export const defaultSettings: AppSettings = {
  theme: { value: "system", source: "default" },
  language: { value: "zh-CN", source: "default" },
  titlebar: { value: "native", source: "default" },
  logLevel: { value: "info", source: "default" },
  developerMode: { value: false, source: "default" },
  desktopNotifications: { value: false, source: "default" },
};
export const appModules: AppModules = {
  modules: MODULE_IDS.map((id) => ({
    id,
    version: "0.1.0-alpha.1",
    enabled: true,
    core: id === "account",
    appliedMigrations: 0,
  })),
};
export const paramEntries: ParamEntry[] = [
  {
    key: "account.idle_lock_minutes",
    moduleId: "account",
    kind: { type: "integer", min: 1, max: 1440 },
    value: "15",
    default: "15",
    isDefault: true,
    secretSet: false,
    rowVersion: null,
    updatedAt: null,
    group: "account.security",
    order: 10,
    readPermission: null,
    writePermission: "account.security.manage",
    effect: "nextRead",
    source: "default",
  },
  ...(
    [
      {
        key: "demo.batch_size",
        kind: { type: "integer", min: 1, max: 100 },
        value: "25",
        order: 10,
        effect: "nextJob",
      },
      {
        key: "demo.test_text",
        kind: { type: "text", maxChars: 4 },
        value: "a",
        order: 20,
        effect: "nextRead",
      },
      {
        key: "demo.test_secret",
        kind: { type: "secret" },
        value: null,
        order: 30,
        effect: "nextRead",
      },
    ] satisfies Pick<
      ParamEntry,
      "key" | "kind" | "value" | "order" | "effect"
    >[]
  ).map(
    (entry): ParamEntry => ({
      ...entry,
      moduleId: "demo",
      default: entry.value,
      isDefault: true,
      secretSet: false,
      rowVersion: null,
      updatedAt: null,
      group: "demo.work",
      readPermission: "demo.settings.manage",
      writePermission: "demo.settings.manage",
      source: "default",
    }),
  ),
  ...(
    [
      {
        key: "notify.quiet_enabled",
        kind: { type: "boolean" },
        value: "false",
        order: 50,
      },
      {
        key: "notify.toast_position",
        kind: {
          type: "choice",
          values: [
            "bottom-right",
            "bottom-left",
            "bottom-center",
            "top-right",
            "top-left",
            "top-center",
          ],
        },
        value: "bottom-right",
        order: 100,
      },
    ] satisfies Pick<ParamEntry, "key" | "kind" | "value" | "order">[]
  ).map(
    (entry): ParamEntry => ({
      ...entry,
      moduleId: "notify",
      default: entry.value,
      isDefault: true,
      secretSet: false,
      rowVersion: null,
      updatedAt: null,
      group: "notify.preferences",
      readPermission: null,
      writePermission: null,
      effect: "nextRead",
      source: "default",
    }),
  ),
];

i18n.addResources("zh-CN", "translation", {
  "param.demo.test_text.name": "测试文本",
  "param.demo.test_secret.name": "测试秘密",
});
i18n.addResources("en-US", "translation", {
  "param.demo.test_text.name": "Test text",
  "param.demo.test_secret.name": "Test secret",
});

export function mockAppIpc(
  override?: Parameters<typeof mockIpc>[0],
  settingsPatch: Partial<AppSettings> = {},
) {
  let settings = structuredClone({ ...defaultSettings, ...settingsPatch });
  const parameters = structuredClone(paramEntries);
  let auth = structuredClone(activeAuth);
  let keyboard: KeyboardSettings = {
    canEdit: true,
    snapshot: { schemaVersion: 1, revision: 0, bindings: [] },
  };
  return mockIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    switch (command) {
      case "app_window_edit_state":
      case "app_window_edit_decide":
        return null;
      case "account_auth_status":
        return { ...auth, idleLockMinutes: Number(parameters[0].value) };
      case "account_user_me":
        return currentUser;
      case "account_session_lock":
        auth = { ...auth, state: "locked", permissions: [] };
        return null;
      case "account_auth_logout":
        auth = { ...auth, state: "anonymous", user: null, permissions: [] };
        return null;
      case "app_modules_list":
        return structuredClone(appModules);
      case "app_settings_get":
        return structuredClone(settings);
      case "app_settings_update": {
        const { input } = payload as { input: AppSettingsUpdate };
        settings = {
          ...settings,
          ...Object.fromEntries(
            Object.entries(input).map(([key, value]) => [
              key,
              { value, source: "file" },
            ]),
          ),
        };
        return structuredClone(settings);
      }
      case "app_keyboard_get":
        return structuredClone(keyboard);
      case "app_keyboard_update": {
        const { input } = payload as { input: KeyboardUpdate };
        if (input.expectedRevision !== keyboard.snapshot.revision)
          throw {
            code: "app.keyboard.conflict",
            params: {},
            traceId: "keyboard-conflict",
          };
        keyboard = {
          canEdit: true,
          snapshot: {
            ...keyboard.snapshot,
            revision: keyboard.snapshot.revision + 1,
            bindings: input.bindings,
          },
        };
        return structuredClone(keyboard);
      }
      case "app_setting_list":
        return structuredClone(parameters);
      case "app_setting_set":
      case "app_setting_reset": {
        const { input } = payload as {
          input: SettingSetInput | SettingResetInput;
        };
        const entry = parameters.find((item) => item.key === input.key);
        if (!entry) throw new Error(`Unexpected parameter: ${input.key}`);
        if (input.rowVersion !== entry.rowVersion)
          throw {
            code: "app.data.version_conflict",
            params: {},
            traceId: "param-conflict",
          };
        const reset = command === "app_setting_reset";
        entry.value = reset ? entry.default : (input as SettingSetInput).value;
        if (entry.kind.type === "secret") {
          entry.value = null;
          entry.secretSet = !reset;
        }
        entry.isDefault =
          entry.kind.type === "secret" ? reset : entry.value === entry.default;
        entry.source = reset ? "default" : "database";
        entry.rowVersion = reset ? null : (entry.rowVersion ?? 0) + 1;
        entry.updatedAt = reset ? null : new Date().toISOString();
        return structuredClone(entry);
      }
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  });
}

export function mockDeveloperIpc(
  override?: Parameters<typeof mockAppIpc>[0],
  settingsPatch: Partial<AppSettings> = {},
) {
  return mockAppIpc(override, {
    developerMode: { value: true, source: "file" },
    ...settingsPatch,
  });
}

const clients: ReturnType<typeof createQueryClient>[] = [];
export function queryWrapper() {
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
beforeEach(async () => {
  installAppearanceStub();
  await i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});
