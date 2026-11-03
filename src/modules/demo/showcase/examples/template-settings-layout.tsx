// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, FormField, FormSection, Input, Switch } from "@/kit";

export function TemplateSettingsLayoutExample() {
  const { t } = useTranslation();
  const [name, setName] = useState(t("showcase.templates.planName"));
  const [summary, setSummary] = useState(true);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="min-w-0 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(true);
      }}
    >
      <Badge>{t("showcase.templates.newExample")}</Badge>
      <p className="text-sm text-muted-foreground">
        {t("showcase.templates.settingsBoundary")}
      </p>
      <FormSection
        title={t("showcase.templates.settingsSection")}
        description={t("showcase.templates.fictional")}
      >
        <FormField label={t("showcase.templates.name")}>
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />
          )}
        </FormField>
        <FormField
          label={t("showcase.templates.summaryOption")}
          orientation="horizontal"
        >
          {(control) => (
            <Switch
              {...control}
              checked={summary}
              onCheckedChange={(value) => {
                setSummary(value);
                setSaved(false);
              }}
            />
          )}
        </FormField>
      </FormSection>
      <Button type="submit" disabled={saved}>
        {t("showcase.templates.saveLayout")}
      </Button>
      <p role="status">
        {t(
          saved
            ? "showcase.templates.layoutSaved"
            : "showcase.templates.unsaved",
        )}
      </p>
    </form>
  );
}
