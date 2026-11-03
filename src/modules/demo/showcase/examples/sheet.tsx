// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/kit";

export function SheetExample() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(t("showcase.overlays.sampleName"));
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline">{t("showcase.overlays.openSheet")}</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("showcase.overlays.sheetTitle")}</SheetTitle>
            <SheetDescription>
              {t("showcase.overlays.sheetDescription")}
            </SheetDescription>
          </SheetHeader>
          <FormField label={t("showcase.overlays.name")}>
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <SheetFooter>
            <Button
              onClick={() => {
                setSaved(name);
                setOpen(false);
              }}
            >
              {t("showcase.overlays.saveSheet")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <p role="status" className="break-words text-sm text-muted-foreground">
        {saved === null
          ? t("showcase.overlays.notSaved")
          : t("showcase.overlays.saved", { name: saved })}
      </p>
    </div>
  );
}
