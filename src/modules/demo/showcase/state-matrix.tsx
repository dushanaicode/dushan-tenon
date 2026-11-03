import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Icon,
  ScrollArea,
} from "@/kit";

export function StateMatrix({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Collapsible
      defaultOpen
      data-showcase-block="matrix"
      className="min-w-0 rounded-lg border bg-card p-4"
    >
      <h2>
        <CollapsibleTrigger asChild>
          <Button variant="ghost">
            <Icon iconId="expand" />
            {t("showcase.common.matrix")}
          </Button>
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="space-y-3 pt-3">
        <p className="text-sm text-muted-foreground">
          {t("showcase.common.realStates")}
        </p>
        <ScrollArea
          role="region"
          axis="x"
          className="max-w-full"
          tabIndex={0}
          aria-label={t("showcase.common.matrix")}
        >
          {children}
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
