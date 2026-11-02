// 套件自写；许可见项目根 LICENSE。
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { PageHeader } from "../ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

export type DetailTab = { id: string; label: ReactNode; content: ReactNode };

export type DetailPageProps = {
  title: ReactNode;
  description?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  tabs?: readonly DetailTab[];
  defaultTab?: string;
  children?: ReactNode;
  className?: string;
};

export function DetailPage({
  title,
  description,
  onBack,
  backLabel,
  actions,
  tabs,
  defaultTab,
  children,
  className,
}: DetailPageProps) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="detail-page"
      className={cn("flex min-w-0 flex-col gap-stack", className)}
    >
      <PageHeader
        title={title}
        description={description}
        actions={actions}
        leading={
          onBack && (
            <Button
              data-part="leading"
              type="button"
              variant="ghost"
              size="icon"
              aria-label={backLabel ?? t("kit.detail.back")}
              onClick={onBack}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
          )
        }
      />
      {children}
      {tabs && (
        <Tabs defaultValue={defaultTab ?? tabs[0]?.id}>
          <TabsList variant="line">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id}>
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
