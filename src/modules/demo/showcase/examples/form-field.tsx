// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  FormField,
  FormSection,
  Input,
  SettingGroup,
  SettingRow,
  Switch,
  Textarea,
} from "@/kit";

export function FormFieldExample() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const nameError =
    name.trim() === ""
      ? t("showcase.inputs.requiredError")
      : [...name].length > 12
        ? t("showcase.inputs.nameError")
        : undefined;
  const descriptionError =
    [...description].length > 40
      ? t("showcase.inputs.descriptionError")
      : undefined;
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        setSubmitted(nameError === undefined && descriptionError === undefined);
      }}
    >
      <FormSection
        title={t("showcase.inputs.formTitle")}
        description={t("showcase.inputs.formDescription")}
      >
        <FormField
          label={t("showcase.inputs.name")}
          description={t("showcase.inputs.nameHelp")}
          error={attempted ? nameError : undefined}
          required
        >
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSubmitted(false);
              }}
            />
          )}
        </FormField>
        <FormField
          label={t("showcase.inputs.description")}
          description={t("showcase.inputs.descriptionHelp")}
          error={attempted ? descriptionError : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setSubmitted(false);
              }}
            />
          )}
        </FormField>
      </FormSection>
      <SettingGroup title="SettingGroup / SettingRow" collapsible>
        <SettingRow
          label={t("settings.developerMode")}
          description={t("settings.developerModeDescription")}
        >
          {(control) => <Switch {...control} />}
        </SettingRow>
      </SettingGroup>
      <Button type="submit">{t("showcase.inputs.validate")}</Button>
      {submitted && <p role="status">{t("showcase.inputs.submitted")}</p>}
    </form>
  );
}
