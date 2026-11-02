// 套件自写；许可见项目根 LICENSE。
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type LoadingProps = {
  label?: string;
  size?: "block" | "page";
  className?: string;
};

export function Loading({ label, size = "block", className }: LoadingProps) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="loading"
      data-size={size}
      role="status"
      aria-busy="true"
      className={cn("kit-loading p-panel text-body", className)}
    >
      <Loader2
        aria-hidden="true"
        data-motion-item
        className="kit-spin size-4 shrink-0"
      />
      {label !== "" && (
        <span data-part="title" className="kit-load-label">
          {label ?? t("kit.loading")}
        </span>
      )}
    </div>
  );
}
