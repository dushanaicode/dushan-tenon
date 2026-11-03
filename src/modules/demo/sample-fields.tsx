import { useTranslation } from "react-i18next";
import { FormField, Input, Textarea } from "@/kit";
import type { DemoDraftFields } from "@/lib/generated/DemoDraftFields";

export function SampleFields({
  value,
  onChange,
  editing,
}: {
  value: DemoDraftFields;
  onChange: (fields: DemoDraftFields) => void;
  editing: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FormField label={t("demo.sample.code")} required>
        {(control) => (
          <Input
            {...control}
            name="code"
            value={value.code}
            onChange={(event) =>
              onChange({ ...value, code: event.currentTarget.value })
            }
            readOnly={editing}
            maxLength={32}
          />
        )}
      </FormField>
      <FormField label={t("demo.sample.title")} required>
        {(control) => (
          <Input
            {...control}
            name="title"
            value={value.title}
            onChange={(event) =>
              onChange({ ...value, title: event.currentTarget.value })
            }
          />
        )}
      </FormField>
      <FormField label={t("demo.sample.note")} description={t("demo.noteHint")}>
        {(control) => (
          <Textarea
            {...control}
            name="note"
            value={value.note}
            onChange={(event) =>
              onChange({ ...value, note: event.currentTarget.value })
            }
          />
        )}
      </FormField>
    </>
  );
}
