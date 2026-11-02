// 套件自写；许可见项目根 LICENSE。
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { PageHeader } from "../ui/page-header";
import { Spinner } from "../ui/spinner";
import { Stepper } from "../ui/stepper";

export type WizardStep = { id: string; label: string; content: ReactNode };

export type WizardPageProps = {
  title: ReactNode;
  description?: ReactNode;
  label: string;
  steps: readonly WizardStep[];
  current: number;
  onCurrentChange: (index: number) => void;
  onFinish: () => void;
  finishLabel?: string;
  canProceed?: boolean;
  pending?: boolean;
  className?: string;
};

export function WizardPage({
  title,
  description,
  label,
  steps,
  current,
  onCurrentChange,
  onFinish,
  finishLabel,
  canProceed = true,
  pending,
  className,
}: WizardPageProps) {
  const { t } = useTranslation();
  const active = Math.min(steps.length - 1, Math.max(0, current));
  const last = active === steps.length - 1;
  return (
    <div
      data-slot="wizard-page"
      className={cn("flex min-w-0 flex-col gap-stack", className)}
    >
      <PageHeader title={title} description={description} />
      <Stepper
        steps={steps.map(({ id, label }) => ({ id, label }))}
        current={active}
        label={label}
      />
      <div data-slot="wizard-page-content" aria-live="polite">
        {steps[active].content}
      </div>
      <div
        data-slot="wizard-page-actions"
        className="flex justify-end gap-2 border-t border-border py-panel"
      >
        <Button
          type="button"
          variant="outline"
          disabled={active === 0}
          onClick={() => onCurrentChange(active - 1)}
        >
          {t("kit.wizard.previous")}
        </Button>
        {last ? (
          <Button
            type="button"
            disabled={!canProceed || pending}
            aria-busy={pending}
            onClick={() => onFinish()}
          >
            {pending && <Spinner aria-hidden="true" />}
            {finishLabel ?? t("kit.wizard.finish")}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!canProceed}
            onClick={() => onCurrentChange(active + 1)}
          >
            {t("kit.wizard.next")}
          </Button>
        )}
      </div>
    </div>
  );
}
