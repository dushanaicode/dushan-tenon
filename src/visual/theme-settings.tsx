import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  isOverridden,
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "@/core/app-settings";
import { useAppearanceSnapshot } from "@/core/appearance-bridge";
import { IpcErrorMessage } from "@/core/ipc-error";
import { SettingSelect } from "@/core/settings/setting-select";
import { SettingSource } from "@/core/settings/setting-source";
import { Loading, SettingGroup } from "@/kit";
import { ACCENTS, THEME_STYLES } from "@/lib/generated/appearance";
import { cn } from "@/lib/utils";
import { VISUAL_THEMES } from "./themes/registry";

/** 外观设置里的主题卡片与强调色；立即保存并生效。 */
export function ThemeSettings() {
  const { t } = useTranslation();
  const name = useId();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  const { dark } = useAppearanceSnapshot();
  if (settings.isPending) return <Loading label={t("kit.loading")} />;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const { themeStyle, accent } = settings.data;
  const locked = pending || isOverridden(themeStyle.source);
  return (
    <SettingGroup title={t("settings.appearance.themeStyle")}>
      <div className="space-y-2">
        <div
          role="radiogroup"
          aria-label={t("settings.appearance.themeStyle")}
          className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
        >
          {THEME_STYLES.map((id) => {
            const art = VISUAL_THEMES[id].art;
            const checked = themeStyle.value === id;
            return (
              <label
                key={id}
                data-visual="theme-card"
                data-state={checked ? "checked" : "unchecked"}
                className={cn(
                  "group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card text-left",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                  checked && "border-primary ring-1 ring-primary",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={id}
                  checked={checked}
                  disabled={locked}
                  onChange={() => update.mutate({ themeStyle: id })}
                  className="sr-only"
                />
                <span
                  data-part="thumb"
                  data-theme-thumb={id}
                  className={cn(
                    "block aspect-video w-full border-b bg-muted",
                    // 标准主题的样张由 visual/styles.css 分层绘制，不能被 cover 拉伸。
                    art && "bg-cover bg-center",
                  )}
                  style={
                    art
                      ? {
                          backgroundImage: `url(${dark ? art.thumb.dark : art.thumb.light})`,
                        }
                      : undefined
                  }
                />
                <span className="flex flex-col gap-0.5 p-3">
                  <span className="flex items-center justify-between gap-2 font-medium">
                    {t(`visual.theme.${id}`)}
                    {checked && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {t("visual.theme.selected")}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t(`visual.theme.${id}.description`)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <SettingSource source={themeStyle.source} />
      </div>
      <SettingSelect
        label={t("settings.appearance.accent")}
        description={t("settings.appearance.accentHint")}
        value={accent.value}
        source={accent.source}
        options={ACCENTS.map((value) => ({
          value,
          label: t(`settings.appearance.accent.${value}`),
        }))}
        disabled={
          pending ||
          isOverridden(accent.source) ||
          themeStyle.value !== "standard"
        }
        onValueChange={(accent) => update.mutate({ accent })}
      />
      {update.isError && <IpcErrorMessage error={update.error} />}
    </SettingGroup>
  );
}
