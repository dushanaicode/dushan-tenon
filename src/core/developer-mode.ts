import { useAppSettings } from "@/core/app-settings";

export function useDeveloperMode(): boolean {
  return useAppSettings().data?.developerMode.value === true;
}
