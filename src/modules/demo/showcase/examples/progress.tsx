// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Progress } from "@/kit";

export function ProgressExample() {
  const { t } = useTranslation();
  const [completed, setCompleted] = useState(2);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p role="status">
          {t("showcase.feedback.knownProgress", { completed, total: 4 })}
        </p>
        <Progress
          aria-label={t("showcase.feedback.knownLabel")}
          value={completed * 25}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={completed === 4}
            onClick={() => setCompleted(completed + 1)}
          >
            {t("showcase.feedback.advance")}
          </Button>
          <Button variant="outline" onClick={() => setCompleted(0)}>
            {t("showcase.feedback.restart")}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <p>{t("showcase.feedback.unknownProgress")}</p>
        <Progress
          aria-label={t("showcase.feedback.unknownProgress")}
          value={null}
        />
      </div>
    </div>
  );
}
