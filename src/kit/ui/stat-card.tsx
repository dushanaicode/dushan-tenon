// 套件自写；许可见项目根 LICENSE。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader } from "./card";
import { Progress } from "./progress";

export type StatCardProps = {
  title: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  progress?: number;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
};

const tones = {
  default: {
    value: "text-foreground",
    progress: "[&_[data-slot=progress-indicator]]:bg-primary",
  },
  success: {
    value: "text-success",
    progress: "[&_[data-slot=progress-indicator]]:bg-success",
  },
  warning: {
    value: "text-warning",
    progress: "[&_[data-slot=progress-indicator]]:bg-warning",
  },
  danger: {
    value: "text-destructive",
    progress: "[&_[data-slot=progress-indicator]]:bg-destructive",
  },
};

export function StatCard({
  title,
  value,
  unit,
  hint,
  progress,
  tone = "default",
  className,
}: StatCardProps) {
  return (
    <Card data-slot="stat-card" className={cn("gap-stack", className)}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-stack">
        <div data-part="value-line" className="flex items-baseline gap-1">
          <div
            data-slot="stat-card-value"
            className={cn(
              "text-3xl font-semibold tabular-nums",
              tones[tone].value,
            )}
          >
            {value}
          </div>
          {unit !== undefined && (
            <span className="text-sm text-muted-foreground">{unit}</span>
          )}
        </div>
        {progress !== undefined && (
          <Progress
            value={Math.min(100, Math.max(0, progress))}
            aria-label={title}
            className={tones[tone].progress}
          />
        )}
        {hint != null && (
          <div
            data-slot="stat-card-hint"
            className="text-sm text-muted-foreground"
          >
            {hint}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
