// showcase-example
import { useTranslation } from "react-i18next";
import { KeyValueList } from "@/kit";
import { displayRecord } from "./timeline";

export function KeyValueListExample() {
  const { t } = useTranslation();
  return (
    <KeyValueList
      items={[
        {
          key: "name",
          label: t("showcase.display.name"),
          value: t(displayRecord.nameKey),
        },
        {
          key: "progress",
          label: t("showcase.display.progress"),
          value: t("showcase.display.progressValue", displayRecord),
        },
        {
          key: "status",
          label: t("showcase.display.status"),
          value: t("showcase.display.running"),
        },
      ]}
    />
  );
}
