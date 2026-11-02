// 套件自写；许可见项目根 LICENSE。
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type StepperStep = { id: string; label: string };
export type StepperProps = {
  steps: readonly StepperStep[];
  current: number;
  label: string;
  className?: string;
};

export function Stepper({ steps, current, label, className }: StepperProps) {
  const { t } = useTranslation();
  const active = Math.min(steps.length - 1, Math.max(0, current));
  return (
    <ol
      data-slot="stepper"
      aria-label={label}
      className={cn("@container flex items-center gap-2", className)}
    >
      {steps.map((step, index) => (
        <li
          key={step.id}
          data-slot="stepper-step"
          aria-current={index === active ? "step" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
        >
          <span
            data-slot="stepper-indicator"
            className={cn(
              "flex size-control shrink-0 items-center justify-center",
              "rounded-full border text-body font-semibold",
              index === active
                ? "border-primary bg-primary text-primary-foreground"
                : index < active
                  ? "border-primary text-brand"
                  : "border-border text-muted-foreground",
            )}
          >
            {index < active ? (
              <>
                <Check aria-hidden="true" className="size-4" />
                <span className="sr-only">{t("kit.stepper.completed")}</span>
              </>
            ) : (
              index + 1
            )}
          </span>
          <span
            data-slot="stepper-label"
            className={cn(
              "truncate text-body",
              index === active
                ? "font-semibold text-foreground"
                : "sr-only text-muted-foreground @sm:not-sr-only",
            )}
          >
            {step.label}
          </span>
          {index < steps.length - 1 && (
            <span
              data-slot="stepper-connector"
              aria-hidden="true"
              className={cn(
                "h-px min-w-2 flex-1",
                index < active ? "bg-primary" : "bg-border",
              )}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
