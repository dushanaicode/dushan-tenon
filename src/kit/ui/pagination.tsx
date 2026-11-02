// Original kit component.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  className?: string;
};

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  disabled,
  className,
}: PaginationProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      data-slot="pagination"
      aria-label={t("kit.pagination.label")}
      className={cn("flex flex-wrap items-center gap-stack", className)}
    >
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft aria-hidden="true" />
        {t("kit.pagination.previous")}
      </Button>
      <p aria-live="polite" className="text-body text-muted-foreground">
        {t("kit.pagination.summary", { page, pages, total })}
      </p>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        {t("kit.pagination.next")}
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
