// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Icon,
} from "@/kit";

export function ThemeTokensExample() {
  const { t } = useTranslation();
  const [marked, setMarked] = useState(false);
  return (
    <Card className="min-w-0 rounded-lg border-border bg-card text-card-foreground">
      <CardHeader>
        <CardTitle>{t("showcase.appearance.example.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          {t("showcase.appearance.example.description")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button aria-pressed={marked} onClick={() => setMarked(!marked)}>
            <Icon iconId="selected" />
            {t("showcase.appearance.example.toggle")}
          </Button>
          <Badge tone={marked ? "success" : "neutral"}>
            {t(
              marked
                ? "showcase.appearance.example.marked"
                : "showcase.appearance.example.unmarked",
            )}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
