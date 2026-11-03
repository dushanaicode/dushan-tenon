// showcase-example
import { useTranslation } from "react-i18next";
import { Alert } from "@/kit";

export function AlertExample() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <Alert tone="info" title={t("showcase.feedback.info")}>
        {t("showcase.feedback.infoReason")}
      </Alert>
      <Alert tone="success" title={t("showcase.feedback.success")}>
        {t("showcase.feedback.successReason")}
      </Alert>
      <Alert tone="warning" title={t("showcase.feedback.warning")}>
        {t("showcase.feedback.warningReason")}
      </Alert>
      <Alert tone="danger" title={t("showcase.feedback.danger")}>
        {t("showcase.feedback.dangerReason")}
      </Alert>
    </div>
  );
}
