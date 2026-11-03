// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, ToggleGroup, ToggleGroupItem } from "@/kit";

export function ToggleGroupExample() {
  const { t } = useTranslation();
  const [view, setView] = useState("list");
  const [details, setDetails] = useState<string[]>(["notes"]);
  return (
    <div className="space-y-3">
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={setView}
        aria-label={t("showcase.choices.singleToggle")}
      >
        <ToggleGroupItem value="list">
          {view === "list" && <Icon iconId="selected" />}
          {t("showcase.choices.list")}
        </ToggleGroupItem>
        <ToggleGroupItem value="cards">
          {view === "cards" && <Icon iconId="selected" />}
          {t("showcase.choices.cards")}
        </ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        type="multiple"
        value={details}
        onValueChange={setDetails}
        aria-label={t("showcase.choices.multiToggle")}
      >
        <ToggleGroupItem value="notes">
          {details.includes("notes") && <Icon iconId="selected" />}
          {t("showcase.choices.notes")}
        </ToggleGroupItem>
        <ToggleGroupItem value="pictures">
          {details.includes("pictures") && <Icon iconId="selected" />}
          {t("showcase.choices.pictures")}
        </ToggleGroupItem>
      </ToggleGroup>
      <p role="status">
        {t("showcase.choices.toggleState", {
          view:
            view === ""
              ? t("showcase.choices.none")
              : view === "list"
                ? t("showcase.choices.list")
                : t("showcase.choices.cards"),
          count: details.length,
        })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("showcase.choices.toggleHelp")}
      </p>
    </div>
  );
}
