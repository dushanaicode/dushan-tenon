// Adapted from shadcn/ui's MIT-licensed new-york-v4 Spinner (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type SpinnerProps = ComponentProps<"svg">;

export function Spinner({
  className,
  "aria-label": ariaLabel,
  ...props
}: SpinnerProps) {
  const { t } = useTranslation();
  return (
    <Loader2
      data-slot="spinner"
      data-motion-item
      role="status"
      aria-label={ariaLabel ?? t("kit.loading")}
      className={cn("size-4 kit-spin", className)}
      {...props}
    />
  );
}
