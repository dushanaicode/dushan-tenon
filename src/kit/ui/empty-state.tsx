// Adapted from shadcn/ui's MIT-licensed new-york-v4 Empty (shadcn-ui/ui d2fba50); semantic kit tokens.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-stack",
        "rounded-lg p-panel text-center text-body text-balance",
        className,
      )}
    >
      <div
        data-slot="empty-header"
        className="flex max-w-sm flex-col items-center gap-2"
      >
        {Icon && (
          <div
            data-slot="empty-icon"
            className={cn(
              "flex size-12 items-center justify-center rounded-full",
              "bg-muted text-muted-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-6" />
          </div>
        )}
        <div data-slot="empty-title" className="text-lg font-medium">
          {title}
        </div>
        {description != null && (
          <div
            data-slot="empty-description"
            className="text-body text-muted-foreground"
          >
            {description}
          </div>
        )}
      </div>
      {action != null && <div data-slot="empty-content">{action}</div>}
    </div>
  );
}
