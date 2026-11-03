// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormField,
  Input,
} from "@/kit";

export function DialogExample() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(t("showcase.overlays.sampleName"));
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setFailed(false);
        }}
      >
        <DialogTrigger asChild>
          <Button>{t("showcase.overlays.openDialog")}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("showcase.overlays.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("showcase.overlays.submitScenario")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!failed) {
                setFailed(true);
                return;
              }
              setSaved(name);
              setOpen(false);
            }}
          >
            <FormField label={t("showcase.overlays.name")} required>
              {(control) => (
                <Input
                  {...control}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </FormField>
            {failed && (
              <Alert tone="danger" title={t("showcase.overlays.failedTitle")}>
                {t("showcase.overlays.failedReason")}
              </Alert>
            )}
            <DialogFooter>
              <Button type="submit">{t("showcase.overlays.save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <p role="status" className="break-words text-sm text-muted-foreground">
        {saved === null
          ? t("showcase.overlays.notSaved")
          : t("showcase.overlays.saved", { name: saved })}
      </p>
    </div>
  );
}
