// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormField, Slider } from "@/kit";

export function SliderExample() {
  const { t } = useTranslation();
  const [value, setValue] = useState(40);
  return (
    <FormField
      label={t("showcase.inputs.opacity", { value })}
      description={t("showcase.inputs.sliderHelp")}
    >
      {(control) => (
        <Slider
          {...control}
          value={value}
          min={0}
          max={100}
          step={5}
          onChange={(event) => setValue(event.target.valueAsNumber)}
        />
      )}
    </FormField>
  );
}
