// showcase-example
import { useTranslation } from "react-i18next";
import { Button, Icon, Tooltip, TooltipContent, TooltipTrigger } from "@/kit";

export function TooltipExample() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("showcase.overlays.tooltipName")}
          >
            <Icon iconId="info" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {t("showcase.overlays.tooltipText")}
        </TooltipContent>
      </Tooltip>
      <p className="text-sm text-muted-foreground">
        {t("showcase.overlays.tooltipText")}
      </p>
    </div>
  );
}
