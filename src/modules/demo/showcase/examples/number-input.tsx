// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormField, NumberInput } from "@/kit";

export function NumberInputExample() {
  const { t } = useTranslation();
  const [value, setValue] = useState<number | null>(1.5);
  const [duration, setDuration] = useState<number | null>(2);
  return (
    <div className="space-y-4">
      <FormField
        label={t("showcase.inputs.number")}
        description={t("showcase.inputs.numberHelp")}
      >
        {(control) => (
          <NumberInput
            {...control}
            value={value}
            onValueChange={setValue}
            min={0}
            max={3}
            step={0.1}
          />
        )}
      </FormField>
      <p role="status">
        {t("showcase.inputs.numericValue", {
          value: value === null ? "null" : value,
        })}
      </p>
      <FormField
        label={t("showcase.inputs.duration")}
        description={t("showcase.inputs.unitHelp")}
      >
        {(control) => (
          <div className="flex items-center gap-2">
            <NumberInput
              {...control}
              className="min-w-0 flex-1"
              value={duration}
              onValueChange={setDuration}
              min={0}
              max={10}
              step={0.5}
            />
            <span aria-hidden="true" className="shrink-0 text-sm">
              {t("showcase.inputs.seconds")}
            </span>
          </div>
        )}
      </FormField>
    </div>
  );
}
