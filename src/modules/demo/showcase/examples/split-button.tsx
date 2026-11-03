// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@/kit";

export function SplitButtonExample() {
  const { t } = useTranslation();
  const [result, setResult] = useState("showcase.buttons.idle");
  return (
    <div className="space-y-2">
      <fieldset
        aria-label={t("showcase.buttons.runMode")}
        className="flex items-center gap-1"
      >
        <Button onClick={() => setResult("showcase.buttons.ran")}>
          {t("showcase.buttons.run")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("showcase.buttons.more")}
            >
              <Icon iconId="expand" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onSelect={() => setResult("showcase.buttons.previewed")}
            >
              {t("showcase.buttons.previewOnly")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setResult("showcase.buttons.detailed")}
            >
              {t("showcase.buttons.details")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </fieldset>
      <p role="status" className="text-sm text-muted-foreground">
        {t(result)}
      </p>
    </div>
  );
}
