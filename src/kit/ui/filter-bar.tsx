// Original kit component.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export type FilterBarProps = {
  onSubmit: (values: FormData) => void;
  onReset?: () => void;
  label?: string;
  pending?: boolean;
  submitLabel?: string;
  resetLabel?: string;
  children: ReactNode;
  className?: string;
};

export function FilterBar({
  onSubmit,
  onReset,
  label,
  pending,
  submitLabel,
  resetLabel,
  children,
  className,
}: FilterBarProps) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA 以 form[role=search] 作为 search 地标的标准写法；保持单层表单，不为 search 元素再包一层。
    <form
      data-slot="filter-bar"
      noValidate
      role="search"
      aria-label={label}
      className={cn("flex flex-wrap items-end gap-stack p-panel", className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      {children}
      <Button type="submit" disabled={pending}>
        {submitLabel ?? t("kit.filter.search")}
      </Button>
      {onReset && (
        <Button
          type="button"
          variant="outline"
          onClick={(event) => {
            const form = event.currentTarget.form as HTMLFormElement;
            form.reset();
            onReset();
          }}
        >
          {resetLabel ?? t("kit.filter.reset")}
        </Button>
      )}
    </form>
  );
}
