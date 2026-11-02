// 套件自写；许可见项目根 LICENSE。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "../ui/page-header";
import { StatCard, type StatCardProps } from "../ui/stat-card";

export type DashboardStat = StatCardProps & { id: string };

export type DashboardPageProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  stats?: readonly DashboardStat[];
  children?: ReactNode;
  className?: string;
};

export function DashboardPage({
  title,
  description,
  actions,
  stats,
  children,
  className,
}: DashboardPageProps) {
  return (
    <div
      data-slot="dashboard-page"
      className={cn("flex min-w-0 flex-col gap-stack", className)}
    >
      <PageHeader title={title} description={description} actions={actions} />
      {stats && (
        <div
          data-slot="dashboard-page-stats"
          className="grid grid-cols-1 gap-stack @min-[560px]/content:grid-cols-2 @min-[960px]/content:grid-cols-3"
        >
          {stats.map(({ id, ...stat }) => (
            <StatCard key={id} {...stat} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
