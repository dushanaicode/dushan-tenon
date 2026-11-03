import { useTranslation } from "react-i18next";
import {
  Button,
  EmptyState,
  ErrorView,
  FormField,
  Input,
  Loading,
  Spinner,
} from "@/kit";
import catalog from "../catalog/appearance-behavior.json";
import { AccordionExample } from "../examples/accordion";
import { CollapsibleExample } from "../examples/collapsible";
import { DialogExample } from "../examples/dialog";
import { WindowControlsExample } from "../examples/window-controls";
import { ShowcasePage } from "../showcase-page";
import { AccessibilityReadings } from "../standard-readings";

export const behaviorExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/collapsible.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/accordion.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/window-controls.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/dialog.tsx?raw")
      : undefined,
  },
];

export function AppearanceBehaviorPage() {
  const { t } = useTranslation();
  return (
    <ShowcasePage
      id="appearance-behavior"
      entries={catalog}
      examples={behaviorExamples}
      matrix={<AccessibilityReadings />}
      preview={
        <>
          <section className="space-y-3">
            <h3 className="font-semibold">{t("showcase.readings.focus")}</h3>
            <FormField label={t("showcase.readings.longLabel")}>
              {(control) => (
                <Input
                  {...control}
                  placeholder={t("showcase.readings.longLabel")}
                />
              )}
            </FormField>
            <div className="flex flex-wrap gap-3">
              <Button>{t("showcase.buttons.default")}</Button>
              <Button disabled>{t("showcase.buttons.disabled")}</Button>
              <Button disabled aria-busy="true">
                <Spinner />
                {t("kit.loading")}
              </Button>
            </div>
            <Loading />
            <EmptyState title={t("showcase.feedback.empty")} />
            <ErrorView message={t("showcase.feedback.errorReason")} />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">
              {t("showcase.appearance-behavior.disclosure")}
            </h3>
            <CollapsibleExample />
            <AccordionExample />
            <DialogExample />
          </section>
          <WindowControlsExample />
        </>
      }
    />
  );
}
