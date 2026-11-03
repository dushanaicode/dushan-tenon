// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, ErrorView } from "@/kit";

export function ErrorViewExample() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(true);
  return failed ? (
    <ErrorView
      title={t("showcase.feedback.errorTitle")}
      message={t("showcase.feedback.errorReason")}
      retryLabel={t("showcase.feedback.retry")}
      onRetry={() => setFailed(false)}
    />
  ) : (
    <div className="space-y-3">
      <Alert tone="success">{t("showcase.feedback.recovered")}</Alert>
      <Button variant="outline" onClick={() => setFailed(true)}>
        {t("showcase.feedback.failAgain")}
      </Button>
    </div>
  );
}
