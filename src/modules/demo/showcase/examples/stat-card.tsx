// showcase-example
import { useTranslation } from "react-i18next";
import { StatCard } from "@/kit";
import { displayRecord } from "./timeline";

export function StatCardExample() {
  const { t } = useTranslation();
  return (
    <StatCard
      title={t("showcase.display.completed")}
      value={displayRecord.completed}
      unit={t("showcase.display.unit")}
      hint={t("showcase.display.progressValue", displayRecord)}
      progress={(displayRecord.completed / displayRecord.total) * 100}
      tone="success"
    />
  );
}
