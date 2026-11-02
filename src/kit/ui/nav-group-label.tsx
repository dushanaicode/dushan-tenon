import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NavGroupLabelProps = {
  children: ReactNode;
  className?: string;
};

export function NavGroupLabel({ children, className }: NavGroupLabelProps) {
  return (
    <p data-part="nav-group-label" className={cn("select-none", className)}>
      {children}
    </p>
  );
}
