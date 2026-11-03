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
import type { Language } from "@/lib/generated/Language";
import { KeyboardSection } from "./keyboard-section";
import { NativeSettings } from "./native-settings";

export function GeneralSection() {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  if (settings.isPending) return <Loading label={t("kit.loading")} />;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const { language, titlebar } = settings.data;
  return (
    <section aria-labelledby="general-title" className="space-y-4">
      <h2 id="general-title" className="text-xl font-semibold">
        {t("settings.sections.general")}
      </h2>
      <SettingGroup title={t("settings.groups.language")}>
        <SettingSelect<Language>
          label={t("language.label")}
          value={language.value}
          source={language.source}
          options={[
            { value: "zh-CN", label: "简体中文" },
            { value: "en-US", label: "English" },
          ]}
          disabled={pending || isOverridden(language.source)}
          onValueChange={(language) => update.mutate({ language })}
        />
        {update.isError && <IpcErrorMessage error={update.error} />}
      </SettingGroup>
      <SettingGroup title={t("settings.groups.titlebar")}>
        <SettingRow
          label={t("settings.appearance.titlebar")}
          description={t("settings.appearance.titlebarHint")}
          source={titlebar.source}
          hint={<SettingSource source={titlebar.source} />}
        >
          {(control) => (
            <Switch
              {...control}
              checked={titlebar.value === "native"}
              disabled={pending || isOverridden(titlebar.source)}
              onCheckedChange={(native) =>
                update.mutate({ titlebar: native ? "native" : "hidden" })
              }
            />
          )}
        </SettingRow>
      </SettingGroup>
      <NativeSettings />
      <KeyboardSection />
    </section>
  );
}
