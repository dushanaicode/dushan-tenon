// showcase-example
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  FormField,
  FormSection,
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@/kit";

const initial = { notes: false, pictures: true, format: "summary" };

export function CheckboxFormExample() {
  const { t } = useTranslation();
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const dirty =
    draft.notes !== saved.notes ||
    draft.pictures !== saved.pictures ||
    draft.format !== saved.format;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(draft);
      }}
    >
      <FormSection
        title={t("showcase.choices.package")}
        description={t("showcase.choices.formHelp")}
      >
        <FormField label={t("showcase.choices.notes")} orientation="horizontal">
          {(control) => (
            <Checkbox
              {...control}
              checked={draft.notes}
              onCheckedChange={(value) =>
                setDraft({ ...draft, notes: value === true })
              }
            />
          )}
        </FormField>
        <FormField
          label={t("showcase.choices.pictures")}
          orientation="horizontal"
        >
          {(control) => (
            <Checkbox
              {...control}
              checked={draft.pictures}
              onCheckedChange={(value) =>
                setDraft({ ...draft, pictures: value === true })
              }
            />
          )}
        </FormField>
        <RadioGroup
          aria-label={t("showcase.choices.format")}
          value={draft.format}
          onValueChange={(format) => setDraft({ ...draft, format })}
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
        </RadioGroup>
      </FormSection>
      <p role="status">
        {dirty ? t("showcase.choices.dirty") : t("showcase.choices.clean")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty}>
          {t("showcase.choices.submit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty}
          onClick={() => setDraft(saved)}
        >
          {t("showcase.choices.cancel")}
        </Button>
      </div>
      <p aria-live="polite">
        {t("showcase.choices.applied", {
          notes: saved.notes
            ? t("showcase.choices.yes")
            : t("showcase.choices.no"),
          pictures: saved.pictures
            ? t("showcase.choices.yes")
            : t("showcase.choices.no"),
          format:
            saved.format === "summary"
              ? t("showcase.choices.summary")
              : t("showcase.choices.full"),
        })}
      </p>
    </form>
  );
}
