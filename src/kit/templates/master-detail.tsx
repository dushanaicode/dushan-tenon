// 套件自写；许可见项目根 LICENSE。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "../ui/scroll-area";

export type MasterDetailProps = {
  master: ReactNode;
  detail: ReactNode;
  masterLabel: string;
  detailLabel: string;
  showDetail?: boolean;
  className?: string;
};

export function MasterDetail({
  master,
  detail,
  masterLabel,
  detailLabel,
  showDetail = false,
  className,
}: MasterDetailProps) {
  return (
    <div
      data-slot="master-detail"
      className={cn(
        "grid h-full min-h-0 min-w-0 @medium/content:grid-cols-[18rem_1fr]",
        className,
      )}
    >
      <ScrollArea
        role="region"
        data-slot="master-detail-master"
        aria-label={masterLabel}
        className={cn(
          "min-h-0 min-w-0 @medium/content:border-r @medium/content:border-border",
          showDetail ? "hidden @medium/content:block" : "block",
        )}
      >
        {master}
      </ScrollArea>
      <ScrollArea
        role="region"
        region="content"
        data-slot="master-detail-detail"
        aria-label={detailLabel}
        className={cn(
          "min-h-0 min-w-0",
          showDetail ? "block" : "hidden @medium/content:block",
        )}
      >
        {detail}
      </ScrollArea>
    </div>
  );
}
