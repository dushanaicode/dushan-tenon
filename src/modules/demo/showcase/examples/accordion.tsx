// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/kit";

export function AccordionExample() {
  const { t } = useTranslation();
  const [single, setSingle] = useState("");
  const [multiple, setMultiple] = useState<string[]>([]);
  return (
    <div className="grid min-w-0 gap-4 @3xl:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <h4 className="font-medium">
          {t("showcase.appearance-behavior.accordion.single")}
        </h4>
        <Accordion
          type="single"
          collapsible
          value={single}
          onValueChange={setSingle}
        >
          <AccordionItem value="tokens">
            <AccordionTrigger headingLevel={5}>
              {t("showcase.appearance-behavior.accordion.tokens")}
            </AccordionTrigger>
            <AccordionContent>
              {t("showcase.appearance-behavior.accordion.tokensBody")}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="motion">
            <AccordionTrigger headingLevel={5}>
              {t("showcase.appearance-behavior.accordion.motion")}
            </AccordionTrigger>
            <AccordionContent>
              {t("showcase.appearance-behavior.accordion.motionBody")}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <div className="min-w-0 space-y-2">
        <h4 className="font-medium">
          {t("showcase.appearance-behavior.accordion.multiple")}
        </h4>
        <Accordion type="multiple" value={multiple} onValueChange={setMultiple}>
          <AccordionItem value="keyboard">
            <AccordionTrigger headingLevel={5}>
              {t("showcase.appearance-behavior.accordion.keyboard")}
            </AccordionTrigger>
            <AccordionContent>
              {t("showcase.appearance-behavior.accordion.keyboardBody")}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="long">
            <AccordionTrigger headingLevel={5}>
              {t("showcase.appearance-behavior.accordion.long")}
            </AccordionTrigger>
            <AccordionContent>
              {t("showcase.appearance-behavior.accordion.longBody")}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="disabled" disabled>
            <AccordionTrigger headingLevel={5}>
              {t("showcase.appearance-behavior.accordion.disabled")}
            </AccordionTrigger>
            <AccordionContent>
              {t("showcase.appearance-behavior.accordion.longBody")}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
