// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/kit";

export function TabsExample() {
  const { t } = useTranslation();
  const [value, setValue] = useState("summary");
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabsList
        aria-label={t("showcase.navigation.tabs")}
        className="max-w-full"
      >
        <TabsTrigger value="summary">
          {t("showcase.navigation.summary")}
        </TabsTrigger>
        <TabsTrigger value="history">
          {t("showcase.navigation.history")}
        </TabsTrigger>
        <TabsTrigger value="locked" disabled>
          {t("showcase.navigation.locked")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="summary">
        {t("showcase.navigation.summaryText")}
      </TabsContent>
      <TabsContent value="history">
        {t("showcase.navigation.historyText")}
      </TabsContent>
    </Tabs>
  );
}
