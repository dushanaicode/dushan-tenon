import { useTranslation } from "react-i18next";
import {
  isOverridden,
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "@/core/app-settings";
import { useAppearanceSnapshot } from "@/core/appearance-bridge";
import { IpcErrorMessage } from "@/core/ipc-error";
import { useIpcErrorToast } from "@/core/use-ipc-toast";
import { Button, Icon } from "@/kit";

export function ThemeToggle() {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  const onError = useIpcErrorToast();
  const { dark } = useAppearanceSnapshot();
  if (settings.isPending) return null;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const { source } = settings.data.theme;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t(dark ? "shell.theme.toLight" : "shell.theme.toDark")}
      title={t(`settings.source.${source}`)}
      disabled={pending || isOverridden(source)}
      onClick={() =>
        update.mutate({ theme: dark ? "light" : "dark" }, { onError })
      }
    >
      <Icon iconId={dark ? "theme-light" : "theme-dark"} />
    </Button>
  );
}
