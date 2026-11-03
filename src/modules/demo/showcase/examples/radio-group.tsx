// showcase-example
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Label, RadioGroup, RadioGroupItem } from "@/kit";

export function RadioGroupExample() {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState("summary");
  return (
    <div className="space-y-3">
      <RadioGroup
        aria-label={t("showcase.choices.radioPreview")}
        value={value}
        onValueChange={setValue}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-summary`} value="summary" />
          <Label htmlFor={`${id}-summary`}>
            {t("showcase.choices.summary")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-full`} value="full" />
          <Label htmlFor={`${id}-full`}>{t("showcase.choices.full")}</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-locked`} value="locked" disabled />
          <Label htmlFor={`${id}-locked`}>{t("showcase.choices.locked")}</Label>
        </div>
      </RadioGroup>
      <p role="status">
        {value === "summary"
          ? t("showcase.choices.summary")
          : t("showcase.choices.full")}
      </p>
    </div>
  );
}
