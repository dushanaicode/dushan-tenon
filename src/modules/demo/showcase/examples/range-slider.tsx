// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RangeSlider } from "@/kit";

export function RangeSliderExample() {
  const { t } = useTranslation();
  const [range, setRange] = useState<[number, number]>([20, 70]);
  return (
    <section aria-label={t("showcase.inputs.range")} className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span>{t("showcase.inputs.lowerValue", { value: range[0] })}</span>
        <span>{t("showcase.inputs.upperValue", { value: range[1] })}</span>
      </div>
      <RangeSlider
        value={range}
        onValueChange={setRange}
        min={0}
        max={100}
        step={5}
        minStepsBetweenThumbs={2}
        thumbLabels={[t("showcase.inputs.lower"), t("showcase.inputs.upper")]}
      />
      <div
        aria-hidden="true"
        className="flex justify-between text-xs text-muted-foreground"
      >
        {[0, 25, 50, 75, 100].map((value) => (
          <span key={value}>{value}</span>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("showcase.inputs.rangeHelp")}
      </p>
    </section>
  );
}
