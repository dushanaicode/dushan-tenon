// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, DashboardPage, Timeline } from "@/kit";

export function TemplateDashboardExample() {
  const { t } = useTranslation();
  const [completed, setCompleted] = useState(3);
  return (
    <DashboardPage
      title={t("showcase.templates.dashboardTitle")}
      description={t("showcase.templates.fictional")}
      actions={
        <Button disabled={completed === 4} onClick={() => setCompleted(4)}>
          {t("showcase.templates.finishChunk")}
        </Button>
      }
      stats={[
        {
          id: "done",
          title: t("showcase.templates.completed"),
          value: completed,
          unit: t("showcase.templates.unit"),
          progress: (completed / 4) * 100,
          tone: "success",
        },
        {
          id: "total",
          title: t("showcase.templates.total"),
          value: 4,
          unit: t("showcase.templates.unit"),
        },
      ]}
    >
      <Timeline
        items={[
          {
            id: "created",
            title: t("showcase.templates.planCreated"),
            time: "09:00",
          },
          {
            id: "checked",
            title: t(
              completed === 4
                ? "showcase.templates.allDone"
                : "showcase.templates.inProgress",
            ),
            time: "09:20",
            tone: completed === 4 ? "success" : "info",
          },
        ]}
      />
    </DashboardPage>
  );
}
