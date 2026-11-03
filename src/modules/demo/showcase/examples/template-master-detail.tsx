// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, KeyValueList, MasterDetail } from "@/kit";

export function TemplateMasterDetailExample() {
  const { t } = useTranslation();
  const [nameKey, setNameKey] = useState("showcase.templates.planName");
  const [showDetail, setShowDetail] = useState(false);
  return (
    <MasterDetail
      masterLabel={t("showcase.templates.masterLabel")}
      detailLabel={t("showcase.templates.detailLabel")}
      showDetail={showDetail}
      master={
        <div className="space-y-3 p-3">
          <h3 className="font-semibold">
            {t("showcase.templates.masterLabel")}
          </h3>
          {["showcase.templates.planName", "showcase.templates.otherPlan"].map(
            (key) => (
              <Button
                key={key}
                className="h-auto w-full justify-start whitespace-normal text-left"
                variant={key === nameKey ? "secondary" : "ghost"}
                onClick={() => {
                  setNameKey(key);
                  setShowDetail(true);
                }}
              >
                {t(key)}
              </Button>
            ),
          )}
        </div>
      }
      detail={
        <div className="space-y-4 p-3">
          <Button variant="outline" onClick={() => setShowDetail(false)}>
            {t("showcase.templates.backToList")}
          </Button>
          <KeyValueList
            items={[
              {
                key: "name",
                label: t("showcase.templates.name"),
                value: t(nameKey),
              },
              {
                key: "source",
                label: t("showcase.templates.source"),
                value: t("showcase.templates.fictional"),
              },
            ]}
          />
        </div>
      }
    />
  );
}
