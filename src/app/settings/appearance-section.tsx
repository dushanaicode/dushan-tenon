import { useTranslation } from "react-i18next";
import {
  isOverridden,
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "@/core/app-settings";
import { IpcErrorMessage } from "@/core/ipc-error";
import { SettingSelect } from "@/core/settings/setting-select";
import { SettingSource } from "@/core/settings/setting-source";
import { Loading, SettingGroup, SettingRow, Switch } from "@/kit";
import { DENSITIES, THEMES } from "@/lib/generated/appearance";
import { ThemeSettings } from "@/visual";

export function AppearanceSection() {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  if (settings.isPending) return <Loading label={t("kit.loading")} />;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const { theme, density, motion } = settings.data;
  return (
    <section aria-labelledby="appearance-title" className="space-y-4">
      <h2 id="appearance-title" className="text-xl font-semibold">
        {t("settings.sections.appearance")}
      </h2>
      <ThemeSettings />
      <SettingGroup title={t("settings.groups.display")}>
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
        <SettingSelect
          label={t("settings.appearance.density")}
          value={density.value}
          source={density.source}
          options={DENSITIES.map((value) => ({
            value,
            label: t(`settings.appearance.density.${value}`),
          }))}
          disabled={pending || isOverridden(density.source)}
          onValueChange={(density) => update.mutate({ density })}
        />
        <SettingRow
          label={t("settings.appearance.motion")}
          description={t("settings.appearance.motionHint")}
          source={motion.source}
          hint={<SettingSource source={motion.source} />}
        >
          {(control) => (
            <Switch
              {...control}
              checked={motion.value}
              disabled={pending || isOverridden(motion.source)}
              onCheckedChange={(motion) => update.mutate({ motion })}
            />
          )}
        </SettingRow>
        {update.isError && <IpcErrorMessage error={update.error} />}
      </SettingGroup>
    </section>
  );
}
