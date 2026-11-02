// 套件自写；许可见项目根 LICENSE。
import { type ComponentProps, type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";

const tones = {
  info: { icon: "info", className: "border-info bg-info-soft text-info" },
  success: {
    icon: "success",
    className: "border-success bg-success-soft text-success",
  },
  warning: {
    icon: "warning",
    className: "border-warning bg-warning-soft text-warning",
  },
  danger: {
    icon: "danger",
    className: "border-destructive bg-destructive-soft text-destructive",
  },
} as const;

export type AlertProps = Omit<ComponentProps<"div">, "title" | "role"> & {
  tone?: keyof typeof tones;
  title?: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
};

export function Alert({
  tone = "info",
  title,
  children,
  onDismiss,
  className,
  ...props
}: AlertProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const accessibility: ComponentProps<"div"> = {
    role: tone === "danger" || tone === "warning" ? "alert" : "status",
    "aria-labelledby": title != null ? titleId : undefined,
    "aria-describedby": descriptionId,
  };
  return (
    <div
      {...accessibility}
      {...props}
      data-slot="alert"
      data-tone={tone}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-control border p-4 text-body",
        "forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]",
        tones[tone].className,
        className,
      )}
    >
      <Icon iconId={tones[tone].icon} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        {title != null && (
          <div id={titleId} data-slot="alert-title" className="font-semibold">
            {title}
          </div>
        )}
        <div id={descriptionId} data-slot="alert-description">
          {children}
        </div>
      </div>
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={t("kit.close")}
          onClick={onDismiss}
        >
          <Icon iconId="close" />
        </Button>
      )}
    </div>
  );
}
