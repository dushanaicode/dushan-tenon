// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  FormField,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@/kit";

export function PopoverExample() {
  const { t } = useTranslation();
  const [details, setDetails] = useState(true);
  return (
    <div className="space-y-3">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">
            {t("showcase.overlays.openPopover")}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={t("showcase.overlays.popoverTitle")}
          className="max-w-[calc(100vw-2rem)] space-y-3"
        >
          <h4 className="font-semibold">
            {t("showcase.overlays.popoverTitle")}
          </h4>
          <FormField
            label={t("showcase.overlays.showDetails")}
            orientation="horizontal"
          >
            {(control) => (
              <Switch
                {...control}
                checked={details}
                onCheckedChange={setDetails}
              />
            )}
          </FormField>
        </PopoverContent>
      </Popover>
      <p role="status" className="text-sm text-muted-foreground">
        {t(
          details
            ? "showcase.overlays.detailsShown"
            : "showcase.overlays.detailsHidden",
        )}
      </p>
    </div>
  );
}
