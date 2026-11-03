// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Icon,
} from "@/kit";

export function CollapsibleExample() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline">
            <Icon iconId={open ? "collapse" : "expand"} />
            {t("showcase.appearance-behavior.collapsible.toggle")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <p>{t("showcase.appearance-behavior.collapsible.content")}</p>
        </CollapsibleContent>
      </Collapsible>
      <Badge>
        {t(
          open
            ? "showcase.appearance-behavior.expanded"
            : "showcase.appearance-behavior.collapsed",
        )}
      </Badge>
      <Collapsible disabled>
        <CollapsibleTrigger asChild>
          <Button variant="outline">
            {t("showcase.appearance-behavior.collapsible.disabled")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {t("showcase.appearance-behavior.collapsible.content")}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
