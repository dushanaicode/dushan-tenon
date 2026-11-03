// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FormField,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/kit";

export function SelectExample({
  disabled = false,
  invalid = false,
  initialValue = "",
  longList = true,
}: {
  disabled?: boolean;
  invalid?: boolean;
  initialValue?: string;
  longList?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const archives = Array.from({ length: 24 }, (_, i) => ({
    value: `archive-${i}`,
    label: t("showcase.selects.option", { number: i + 1 }),
  }));
  return (
    <FormField
      label={t("showcase.selects.selectLabel")}
      error={invalid && value === "" ? t("showcase.selects.error") : undefined}
    >
      {(control) => (
        <Select value={value} onValueChange={setValue} disabled={disabled}>
          <SelectTrigger {...control} className="w-full min-w-0">
            <SelectValue placeholder={t("showcase.selects.placeholder")} />
          </SelectTrigger>
          <SelectContent aria-label={t("showcase.selects.selectLabel")}>
            <SelectGroup>
              <SelectLabel>{t("showcase.selects.recommended")}</SelectLabel>
              <SelectItem value="one">{t("showcase.selects.one")}</SelectItem>
              <SelectItem value="long">{t("showcase.selects.long")}</SelectItem>
              <SelectItem value="locked" disabled>
                {t("showcase.selects.locked")}
              </SelectItem>
            </SelectGroup>
            {longList && (
              <SelectGroup>
                <SelectLabel>{t("showcase.selects.archive")}</SelectLabel>
                {archives.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
