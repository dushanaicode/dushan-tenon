import { useTranslation } from "react-i18next";
import { isOverridden } from "@/core/app-settings";
import { useDeveloperMode } from "@/core/developer-mode";
import { Icon } from "@/kit";
import type { ConfigSource } from "@/lib/generated/ConfigSource";

export function SettingSource({
  source,
  locked,
  reason,
}: {
  source: ConfigSource;
  locked?: boolean;
  reason?: string;
}) {
  const { t } = useTranslation();
  const developer = useDeveloperMode();
  if (locked || isOverridden(source))
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Icon iconId="lock" />
        {isOverridden(source)
          ? t(`settings.source.${source}`)
          : (reason ?? t(`settings.source.${source}`))}
      </span>
    );
  return developer ? (
    <span className="text-xs text-muted-foreground">
      {t(`settings.source.${source}`)}
    </span>
  ) : null;
}
