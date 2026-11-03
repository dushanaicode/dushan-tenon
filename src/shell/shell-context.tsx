import { createContext, type ReactNode, useContext } from "react";
import type { ModuleManifest } from "@/core/contracts/module";
import type { VisibilityAuth } from "@/core/visibility";

export type ShellEnvironment = {
  userId: string;
  manifests: readonly ModuleManifest[];
  enabled: ReadonlySet<string>;
  auth: VisibilityAuth;
};
const Context = createContext<ShellEnvironment | null>(null);

export function ShellEnvironmentProvider({
  value,
  children,
}: {
  value: ShellEnvironment;
  children: ReactNode;
}) {
  return <Context value={value}>{children}</Context>;
}
export function useShellEnvironment() {
  const value = useContext(Context);
  if (!value) throw new Error("ShellEnvironmentProvider is required");
  return value;
}
