// Original kit component.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Spinner } from "./spinner";

export type ErrorViewProps = {
  title?: ReactNode;
  message: ReactNode;
  detail?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  className?: string;
};

export function ErrorView({
  title,
  message,
  detail,
  onRetry,
  retryLabel,
  retrying,
  className,
}: ErrorViewProps) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="error-view"
      role="alert"
      className={cn("flex flex-col items-start gap-stack p-panel", className)}
    >
      <h2 data-part="title" className="text-lg font-semibold">
        {title ?? t("kit.error.title")}
      </h2>
      <div data-part="description" className="text-body">
        {message}
      </div>
      {detail != null && (
        <div
          data-part="detail"
          className="text-body break-all text-muted-foreground"
        >
          {detail}
        </div>
      )}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
        >
          {retrying && <Spinner aria-hidden="true" />}
          {retryLabel ?? t("kit.error.retry")}
        </Button>
      )}
    </div>
  );
}
