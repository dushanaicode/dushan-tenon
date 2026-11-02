// 套件自写；许可见项目根 LICENSE。
import { Inbox, Lock, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { EmptyState } from "../ui/empty-state";
import { ErrorView } from "../ui/error-view";
import { Loading } from "../ui/loading";

export type StatusPageKind =
  | "empty"
  | "error"
  | "forbidden"
  | "notFound"
  | "loading";

export type StatusPageProps = {
  kind: StatusPageKind;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  traceId?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
};

const icons = { empty: Inbox, forbidden: Lock, notFound: SearchX };

export function StatusPage({
  kind,
  title,
  description,
  action,
  traceId,
  onRetry,
  retrying,
  className,
}: StatusPageProps) {
  const { t } = useTranslation();
  const loadingLabel =
    typeof title === "string"
      ? title
      : title == null
        ? t("kit.table.loading")
        : "";
  return (
    <section
      data-slot="status-page"
      role={kind === "loading" ? "status" : undefined}
      aria-busy={kind === "loading" ? true : undefined}
      aria-label={
        kind === "loading" && loadingLabel !== "" ? loadingLabel : undefined
      }
      className={cn(
        "flex min-h-64 flex-col items-center justify-center gap-stack",
        "text-center",
        kind !== "loading" && "py-panel",
        className,
      )}
    >
      {kind === "loading" ? (
        <>
          <div aria-hidden="true" className="w-full">
            <Loading size="page" label={loadingLabel} />
          </div>
          {title != null && typeof title !== "string" && (
            <div data-part="title" className="text-body font-medium">
              {title}
            </div>
          )}
          {description != null && (
            <div
              data-part="description"
              className="text-body text-muted-foreground"
            >
              {description}
            </div>
          )}
        </>
      ) : kind === "error" ? (
        <ErrorView
          title={title}
          message={description}
          detail={
            traceId === undefined
              ? undefined
              : t("kit.status.traceId", { traceId })
          }
          onRetry={onRetry}
          retrying={retrying}
          className="items-center"
        />
      ) : (
        <EmptyState
          icon={icons[kind]}
          title={title ?? t(`kit.status.${kind}.title`)}
          description={description ?? t(`kit.status.${kind}.description`)}
          action={action}
        />
      )}
    </section>
  );
}
