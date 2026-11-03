// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, FormDialog, FormField, FormSheet, Input } from "@/kit";

export function TemplateFormSheetExample() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"sheet" | "dialog" | null>(null);
  const [name, setName] = useState(t("showcase.templates.planName"));
  const [saved, setSaved] = useState<string | null>(null);
  const field = (
    <FormField label={t("showcase.templates.name")} required>
      {(control) => (
        <Input
          {...control}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      )}
    </FormField>
  );
  function submit() {
    setSaved(name);
    setKind(null);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("showcase.templates.formNote")}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setKind("sheet")}>
          {t("showcase.templates.openFormSheet")}
        </Button>
        <Button variant="outline" onClick={() => setKind("dialog")}>
          {t("showcase.templates.openFormDialog")}
        </Button>
      </div>
      <FormSheet
        open={kind === "sheet"}
        onOpenChange={(open) => {
          if (!open) setKind(null);
        }}
        title={t("showcase.templates.formTitle")}
        description={t("showcase.templates.fictional")}
        submitLabel={t("showcase.templates.save")}
        onSubmit={submit}
      >
        {field}
      </FormSheet>
      <FormDialog
        open={kind === "dialog"}
        onOpenChange={(open) => {
          if (!open) setKind(null);
        }}
        title={t("showcase.templates.formTitle")}
        description={t("showcase.templates.fictional")}
        submitLabel={t("showcase.templates.save")}
        onSubmit={submit}
      >
        {field}
      </FormDialog>
      <p role="status" className="break-words">
        {saved === null
          ? t("showcase.templates.unsaved")
          : t("showcase.templates.savedName", { name: saved })}
      </p>
    </div>
  );
}
