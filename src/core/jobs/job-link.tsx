import type { ReactNode } from "react";
import { generatePath, Link } from "react-router";
import { useCanOpen } from "@/core/enabled-modules";
import { useModuleDirectory } from "@/core/module-directory";

export function useJobPath(id: string | null): string | undefined {
  const directory = useModuleDirectory();
  const route = directory
    .flatMap((module) => module.workbenchObjects)
    .find((object) => object.kind === "job")?.route;
  const path =
    id === null || route === undefined ? "" : generatePath(route, { id });
  const canOpen = useCanOpen(path);
  return path && canOpen ? path : undefined;
}

export function JobLink({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const path = useJobPath(id);
  return path ? (
    <Link to={path} className={className}>
      {children}
    </Link>
  ) : null;
}
