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
    <section aria-labelledby="appearance-title" className="space-y-4">
      <h2 id="appearance-title" className="text-xl font-semibold">
        {t("settings.sections.appearance")}
      </h2>
      <SettingGroup title={t("settings.sections.appearance")}>
        <SettingSelect
          label={t("settings.appearance.colorMode")}
          value={theme.value}
          source={theme.source}
          options={THEMES.map((value) => ({
            value,
            label: t(`theme.${value}`),
          }))}
          disabled={pending || isOverridden(theme.source)}
          onValueChange={(theme) => update.mutate({ theme })}
        />
        {update.isError && <IpcErrorMessage error={update.error} />}
      </SettingGroup>
    </section>
  );
}
