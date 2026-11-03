import type { Visibility } from "@/core/contracts/module";
import type { AuthMode } from "@/lib/generated/AuthMode";

export type VisibilityAuth = {
  authenticated: boolean;
  developerMode: boolean;
  mode: AuthMode;
  permissions: readonly string[];
};

export function evaluateVisibility(
  visibility: Visibility,
  { authenticated, developerMode, mode, permissions }: VisibilityAuth,
): "visible" | "notFound" | "forbidden" {
  if (!authenticated) return "forbidden";
  if (visibility.developerOnly && !developerMode) return "notFound";
  if (visibility.authMode && visibility.authMode !== mode) return "forbidden";
  if (visibility.permission && !permissions.includes(visibility.permission))
    return "forbidden";
  if (
    visibility.anyPermissions?.length &&
    !visibility.anyPermissions.some((permission) =>
      permissions.includes(permission),
    )
  ) {
    return "forbidden";
  }
  return "visible";
}
