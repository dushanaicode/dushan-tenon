// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, FormField } from "@/kit";

export function ComboboxExample({
  disabled = false,
  invalid = false,
  initialValue = null,
}: {
  disabled?: boolean;
  invalid?: boolean;
  initialValue?: string | null;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<string | null>(initialValue);
  const options = [
    { value: "one", label: t("showcase.selects.one") },
    { value: "long", label: t("showcase.selects.long") },
    { value: "locked", label: t("showcase.selects.locked"), disabled: true },
    ...Array.from({ length: 24 }, (_, i) => ({
      value: `archive-${i}`,
      label: t("showcase.selects.option", { number: i + 1 }),
    })),
  ];
  return (
    <FormField
      label={t("showcase.selects.comboLabel")}
      description={t("showcase.selects.comboHelp")}
      error={
        invalid && value === null ? t("showcase.selects.error") : undefined
      }
    >
      {(control) => (
        <Combobox
          {...control}
          options={options}
          value={value}
          onValueChange={setValue}
          disabled={disabled}
          clearable
          placeholder={t("showcase.selects.placeholder")}
          searchPlaceholder={t("showcase.selects.search")}
          emptyText={t("showcase.selects.empty")}
        />
      )}
    </FormField>
  );
}
