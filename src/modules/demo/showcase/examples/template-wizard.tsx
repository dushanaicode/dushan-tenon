// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FormField, Input, WizardPage } from "@/kit";

export function TemplateWizardExample() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [name, setName] = useState("");
  const [finished, setFinished] = useState(false);
  return (
    <div className="space-y-3">
      <WizardPage
        title={t("showcase.templates.wizardTitle")}
        description={t("showcase.templates.fictional")}
        label={t("showcase.templates.wizardSteps")}
        current={current}
        onCurrentChange={setCurrent}
        canProceed={name.trim() !== "" && !finished}
        finishLabel={t("showcase.templates.finishPlan")}
        onFinish={() => setFinished(true)}
        steps={[
          {
            id: "name",
            label: t("showcase.templates.nameStep"),
            content: (
              <FormField label={t("showcase.templates.name")} required>
                {(control) => (
                  <Input
                    {...control}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                )}
              </FormField>
            ),
          },
          {
            id: "review",
            label: t("showcase.templates.reviewStep"),
            content: (
              <p className="break-words">
                {t("showcase.templates.reviewName", { name })}
              </p>
            ),
          },
        ]}
      />
      {finished && (
        <Alert tone="success">{t("showcase.templates.planFinished")}</Alert>
      )}
    </div>
  );
}
