import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { SettingSection } from "@/core/contracts/settings";
import type { NavTree } from "../nav-tree";
import { useShellEnvironment } from "../shell-context";
import { buildCommands } from "./build-commands";
import type { ShellCommand } from "./types";
import { useBuiltinCommands } from "./use-builtin-commands";

export function useShellCommands(
  tree: NavTree,
  sections: readonly SettingSection[],
): ShellCommand[] {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { enabled, manifests, auth } = useShellEnvironment();
  const builtin = useBuiltinCommands();
  const permissions = auth.permissions;
  return useMemo(
    () =>
      buildCommands({
        tree,
        sections,
        manifests: manifests.filter((manifest) => enabled.has(manifest.id)),
        builtin,
        t: (key) => t(key, { lng: i18n.language }),
        permissions,
        navigate,
      }),
    [
      tree,
      sections,
      manifests,
      enabled,
      builtin,
      t,
      i18n.language,
      permissions,
      navigate,
    ],
  );
}
