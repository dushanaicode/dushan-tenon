import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { AppSettingsUpdate } from "@/lib/generated/AppSettingsUpdate";
import type { ConfigSource } from "@/lib/generated/ConfigSource";
import { appSettingsGet, appSettingsUpdate } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import { applyMode } from "./appearance-bridge";
import { i18n } from "./i18n";

const settingsKey = ["app", "settings"];

async function applySettings(settings: AppSettings) {
  await i18n.changeLanguage(settings.language.value);
  applyMode(settings.theme.value);
  return settings;
}

export function useAppSettings() {
  return useQuery<AppSettings, IpcError>({
    queryKey: settingsKey,
    queryFn: async () => applySettings(await appSettingsGet()),
    staleTime: Infinity,
    retry: false,
  });
}

export function useSettingsUpdate() {
  const client = useQueryClient();
  return useMutation<AppSettings, IpcError, AppSettingsUpdate>({
    mutationKey: settingsKey,
    scope: { id: "app-settings" },
    mutationFn: async (input) => applySettings(await appSettingsUpdate(input)),
    onSuccess: async (settings) => {
      client.setQueryData(settingsKey, settings);
      await client.invalidateQueries({ queryKey: ["app", "about"] });
    },
  });
}

export function useSettingsPending() {
  return useIsMutating({ mutationKey: settingsKey }) > 0;
}

export function isOverridden(source: ConfigSource) {
  return source === "environment" || source === "commandLine";
}
