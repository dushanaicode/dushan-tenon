import { useTranslation } from "react-i18next";
import {
  isOverridden,
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "@/core/app-settings";
import { IpcErrorMessage } from "@/core/ipc-error";
import { SettingSelect } from "@/core/settings/setting-select";
import { Loading, SettingGroup } from "@/kit";
import { THEMES } from "@/lib/generated/appearance";

export function AppearanceSection() {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  if (settings.isPending) return <Loading label={t("kit.loading")} />;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const { theme } = settings.data;
  return (
    <SettingGroup title={t("settings.sections.appearance")}>
      <SettingSelect
        label={t("theme.label")}
        value={theme.value}
        source={theme.source}
        options={THEMES.map((value) => ({ value, label: t(`theme.${value}`) }))}
        disabled={pending || isOverridden(theme.source)}
        onValueChange={(theme) => update.mutate({ theme })}
      />
      {update.isError && <IpcErrorMessage error={update.error} />}
    </SettingGroup>
  );
}
