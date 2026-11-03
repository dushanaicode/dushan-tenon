import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  DataTable,
  type DataTableColumn,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/kit";
import catalog from "../catalog/templates.json";
import { TemplateConversationExample } from "../examples/template-conversation";

import { TemplateDashboardExample } from "../examples/template-dashboard";
import { TemplateDetailExample } from "../examples/template-detail";
import { TemplateFormSheetExample } from "../examples/template-form-sheet";
import { TemplateListExample } from "../examples/template-list";
import { TemplateMasterDetailExample } from "../examples/template-master-detail";
import { TemplateSettingsLayoutExample } from "../examples/template-settings-layout";
import { TemplateStatusExample } from "../examples/template-status";
import { TemplateWizardExample } from "../examples/template-wizard";
import { ShowcasePage } from "../showcase-page";

export const templatesExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-dashboard.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-list.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-master-detail.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-detail.tsx?raw")
      : undefined,
  },
  {
    file: catalog[4].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-form-sheet.tsx?raw")
      : undefined,
  },
  {
    file: catalog[5].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-settings-layout.tsx?raw")
      : undefined,
  },
  {
    file: catalog[6].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-wizard.tsx?raw")
      : undefined,
  },
  {
    file: catalog[7].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-conversation.tsx?raw")
      : undefined,
  },
  {
    file: catalog[8].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/template-status.tsx?raw")
      : undefined,
  },
];
const tabs = [
  { id: "dashboard", key: "showcase.templates.tabDashboard" },
  { id: "list", key: "showcase.templates.tabList" },
  { id: "master-detail", key: "showcase.templates.tabMasterDetail" },
  { id: "detail", key: "showcase.templates.tabDetail" },
  { id: "form", key: "showcase.templates.tabForm" },
  { id: "settings", key: "showcase.templates.tabSettings" },
  { id: "wizard", key: "showcase.templates.tabWizard" },
  { id: "conversation", key: "showcase.templates.tabConversation" },
  { id: "status", key: "showcase.templates.tabStatus" },
];
export function TemplatesPage() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<(typeof catalog)[number]>[]>(
    () => [
      {
        id: "template",
        header: t("showcase.templates.template"),
        rowHeader: true,
        cell: (row) => (
          <div className="space-y-2">
            <p>{t(row.titleKey)}</p>
            {row.kind === "pattern" && (
              <Badge>{t("showcase.templates.newExample")}</Badge>
            )}
          </div>
        ),
      },
      {
        id: "shape",
        header: t("showcase.templates.shape"),
        cell: (row) => t(row.whenToUseKey),
        className: "min-w-64 whitespace-normal",
      },
      {
        id: "boundary",
        header: t("showcase.templates.boundary"),
        cell: (row) => t(row.notForKey),
        className: "min-w-64 whitespace-normal",
      },
    ],
    [t],
  );
  return (
    <ShowcasePage
      id="templates"
      entries={catalog}
      examples={templatesExamples}
      matrix={
        <DataTable
          caption={t("showcase.templates.matrixCaption")}
          columns={columns}
          rows={catalog}
          getRowId={(row) => row.id}
        />
      }
      preview={
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("showcase.templates.settingsBoundary")}
          </p>
          <Tabs defaultValue="dashboard" className="min-w-0">
            <TabsList
              aria-label={t("showcase.templates.choose")}
              className="h-auto w-full flex-wrap justify-start"
            >
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="flex-none">
                  {t(tab.key)}
                </TabsTrigger>
              ))}
            </TabsList>
            <ScrollArea
              role="region"
              axis="both"
              aria-label={t("showcase.templates.previewLabel")}
              className="h-[32rem] min-w-0 rounded-lg border bg-background p-4"
            >
              <TabsContent value="dashboard" className="m-0 h-full min-w-0">
                <TemplateDashboardExample />
              </TabsContent>
              <TabsContent value="list" className="m-0 h-full min-w-0">
                <TemplateListExample />
              </TabsContent>
              <TabsContent value="master-detail" className="m-0 h-full min-w-0">
                <TemplateMasterDetailExample />
              </TabsContent>
              <TabsContent value="detail" className="m-0 h-full min-w-0">
                <TemplateDetailExample />
              </TabsContent>
              <TabsContent value="form" className="m-0 h-full min-w-0">
                <TemplateFormSheetExample />
              </TabsContent>
              <TabsContent value="settings" className="m-0 h-full min-w-0">
                <TemplateSettingsLayoutExample />
              </TabsContent>
              <TabsContent value="wizard" className="m-0 h-full min-w-0">
                <TemplateWizardExample />
              </TabsContent>
              <TabsContent value="conversation" className="m-0 h-full min-w-0">
                <TemplateConversationExample />
              </TabsContent>
              <TabsContent value="status" className="m-0 h-full min-w-0">
                <TemplateStatusExample />
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>
      }
    />
  );
}
