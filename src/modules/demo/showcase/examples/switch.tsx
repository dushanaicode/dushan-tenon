// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormField, Switch } from "@/kit";

export function SwitchExample() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="space-y-3">
      <FormField
        label={t("showcase.choices.liveSwitch")}
        orientation="horizontal"
      >
        {(control) => (
          <Switch {...control} checked={enabled} onCheckedChange={setEnabled} />
        )}
      </FormField>
      <p role="status">
        {enabled ? t("showcase.choices.liveOn") : t("showcase.choices.liveOff")}
      </p>
      {enabled && (
        <p className="rounded-md border p-3">{t("showcase.choices.hint")}</p>
      )}
    </div>
  );
}
