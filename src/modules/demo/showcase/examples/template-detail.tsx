// showcase-example
import { useTranslation } from "react-i18next";
import { DetailPage, KeyValueList, Timeline } from "@/kit";

export function TemplateDetailExample() {
  const { t } = useTranslation();
  return (
    <DetailPage
      title={t("showcase.templates.planName")}
      description={t("showcase.templates.fictional")}
      tabs={[
        {
          id: "attributes",
          label: t("showcase.templates.attributes"),
          content: (
            <KeyValueList
              items={[
                {
                  key: "name",
                  label: t("showcase.templates.name"),
                  value: t("showcase.templates.planName"),
                },
                {
                  key: "status",
                  label: t("showcase.templates.status"),
                  value: t("showcase.templates.inProgress"),
                },
              ]}
            />
          ),
        },
        {
          id: "history",
          label: t("showcase.templates.history"),
          content: (
            <Timeline
              items={[
                {
                  id: "created",
                  title: t("showcase.templates.planCreated"),
                  time: "09:00",
                },
                {
                  id: "checked",
                  title: t("showcase.templates.inProgress"),
                  time: "09:20",
                  tone: "info",
                },
              ]}
            />
          ),
        },
      ]}
    />
  );
}
