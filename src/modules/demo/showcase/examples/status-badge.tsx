// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  StatusDot,
} from "@/kit";
import { displayRecord } from "./timeline";

export function StatusBadgeExample() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar aria-label={t("showcase.display.avatarLabel")}>
            <AvatarFallback>{t("showcase.display.avatarText")}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="break-words font-medium">
              {t(displayRecord.nameKey)}
            </p>
            <Badge tone="info">
              <StatusDot running className="mr-2" />
              {t("showcase.display.running")}
            </Badge>
          </div>
        </div>
        <Button
          variant="outline"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t(
            expanded
              ? "showcase.display.hideDetails"
              : "showcase.display.showDetails",
          )}
        </Button>
        {expanded && (
          <ul className="space-y-2">
            {displayRecord.stages.map((stage) => (
              <li key={stage.id} className="flex flex-wrap items-center gap-2">
                <StatusDot tone={stage.tone} />
                <span>{stage.time}</span>
                <span>{t(stage.titleKey)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
