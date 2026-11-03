// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Stepper } from "@/kit";

export function StepperExample() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const steps = [
    { id: "choose", label: t("showcase.navigation.chooseStep") },
    { id: "review", label: t("showcase.navigation.reviewStep") },
    { id: "done", label: t("showcase.navigation.doneStep") },
  ];
  return (
    <div className="min-w-0 space-y-3">
      <Stepper
        steps={steps}
        current={current}
        label={t("showcase.navigation.steps")}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={current === 0}
          onClick={() => setCurrent(current - 1)}
        >
          {t("showcase.navigation.previousStep")}
        </Button>
        <Button
          disabled={current === 2}
          onClick={() => setCurrent(current + 1)}
        >
          {t("showcase.navigation.nextStep")}
        </Button>
      </div>
    </div>
  );
}
