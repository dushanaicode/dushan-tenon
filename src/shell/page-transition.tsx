import type { ReactNode } from "react";
import { useLocation } from "react-router";

export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div
      key={/^\/settings(?:\/|$)/.test(pathname) ? "/settings" : pathname}
      data-slot="page-transition"
      data-motion-item
      className="kit-enter h-full min-h-max"
    >
      {children}
    </div>
  );
}
