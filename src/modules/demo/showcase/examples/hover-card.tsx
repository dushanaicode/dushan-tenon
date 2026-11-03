// showcase-example
import { useTranslation } from "react-i18next";
import {
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/kit";

export function HoverCardExample() {
  const { t } = useTranslation();
  const summary = (
    <div className="space-y-2">
      <p className="font-semibold">{t("showcase.menus.object")}</p>
      <p>{t("showcase.menus.objectSummary")}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link">{t("showcase.menus.hover")}</Button>
          </HoverCardTrigger>
          <HoverCardContent aria-label={t("showcase.menus.object")}>
            {summary}
          </HoverCardContent>
        </HoverCard>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              {t("showcase.menus.explicitPreview")}
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label={t("showcase.menus.object")}>
            {summary}
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("showcase.menus.hoverHelp")}
      </p>
    </div>
  );
}
