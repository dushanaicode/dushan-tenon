// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState } from "@/kit";

export function EmptyStateExample() {
  const { t } = useTranslation();
  const [created, setCreated] = useState(false);
  return created ? (
    <div className="space-y-3">
      <p role="status">{t("showcase.feedback.created")}</p>
      <Button variant="outline" onClick={() => setCreated(false)}>
        {t("showcase.feedback.clear")}
      </Button>
    </div>
  ) : (
    <EmptyState
      title={t("showcase.feedback.emptyTitle")}
      description={t("showcase.feedback.emptyReason")}
      action={
        <Button onClick={() => setCreated(true)}>
          {t("showcase.feedback.create")}
        </Button>
      }
    />
  );
}
