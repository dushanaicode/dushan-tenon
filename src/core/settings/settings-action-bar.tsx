import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Spinner } from "@/kit";
import { useSettingsDrafts } from "./drafts";

export function SettingsActionBar() {
  const { t } = useTranslation();
  const params = useSettingsDrafts();
  const submitting = useRef(false);
  const count = new Set([...params.drafts.keys(), ...params.items.keys()]).size;
  const canApply = [...params.items.values()].some((item) => item.valid);
  if (count === 0) return null;
  const apply = async () => {
    if (params.applying || !canApply || submitting.current) return;
    submitting.current = true;
    try {
      await params.apply();
    } finally {
      submitting.current = false;
    }
  };
  return (
    <section
      aria-label={t("settings.actions.label")}
      className="settings-action-bar sticky bottom-0 z-10 flex shrink-0 items-center gap-3 border-t bg-background px-3 py-3"
    >
      <div className="min-w-0 flex-1 text-sm" role="status">
        <p>{t("settings.actions.unapplied", { count })}</p>
        {params.applying && <p>{t("settings.saving")}</p>}
        {params.failed.size > 0 && (
          <p className="text-destructive">
            {t("settings.actions.failed", { count: params.failed.size })}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        disabled={params.applying}
        onClick={params.discardAll}
      >
        {t("settings.actions.discard")}
      </Button>
      <Button
        disabled={params.applying || !canApply}
        onClick={() => void apply()}
      >
        {params.applying && <Spinner aria-hidden="true" />}
        {t("settings.appearance.apply")}
      </Button>
    </section>
  );
}
