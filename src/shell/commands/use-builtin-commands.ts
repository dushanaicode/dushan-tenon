import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  isOverridden,
  useAppSettings,
  useSettingsUpdate,
} from "@/core/app-settings";
import { useSessionActions } from "@/core/auth";
import { moduleOfPath, routeOfPath } from "@/core/module-directory";
import { useIpcErrorToast } from "@/core/use-ipc-toast";
import { evaluateVisibility } from "@/core/visibility";
import { ICONS } from "@/kit";
import { useShellEnvironment } from "../shell-context";
import { useShellFocus } from "../shell-focus";
import { useShellTier } from "../use-shell-tier";
import { auxiliaryLayout } from "../workbench/layout";
import { useWorkbenchObjects } from "../workbench/object-view";
import { objectKey } from "../workbench/objects";
import { useWorkbenchPanels } from "../workbench/panels";
import { useWorkbench } from "../workbench/store";
import type { ShellCommand } from "./types";

export function useBuiltinCommands(): ShellCommand[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const { auth, enabled, manifests } = useShellEnvironment();
  const session = useSessionActions();
  const onError = useIpcErrorToast();
  const workbenchCommands = useWorkbenchCommands();

  const profile = moduleOfPath(manifests, "/account/profile");
  const profileRoute = profile && routeOfPath(profile, "/account/profile");
  const commands: ShellCommand[] =
    profile &&
    enabled.has(profile.id) &&
    profileRoute &&
    evaluateVisibility(profileRoute, auth) === "visible"
      ? [
          {
            id: "route:profile",
            group: "pages",
            label: t("shell.userMenu.profile"),
            keywords: [],
            Icon: ICONS.profile,
            run: () => navigate("/account/profile"),
          },
        ]
      : [];
  if (settings.data && !isOverridden(settings.data.theme.source)) {
    for (const theme of ["system", "light", "dark"] as const) {
      commands.push({
        id: `theme:${theme}`,
        group: "appearance",
        label: t(`theme.${theme}`),
        keywords: [],
        run: () => update.mutate({ theme }, { onError }),
      });
    }
  }
  if (settings.data && !isOverridden(settings.data.language.source)) {
    for (const language of ["zh-CN", "en-US"] as const) {
      commands.push({
        id: `language:${language}`,
        group: "language",
        label: language === "zh-CN" ? "简体中文" : "English",
        keywords: [],
        run: () => update.mutate({ language }, { onError }),
      });
    }
  }
  if (auth.mode === "login") {
    for (const action of ["lock", "logout"] as const) {
      commands.push({
        id: `session:${action}`,
        group: "account",
        label: t(`account.auth.${action}`),
        keywords: [],
        run: () => session.mutate(action, { onError }),
      });
    }
  }
  return [...commands, ...workbenchCommands];
}

function useWorkbenchCommands(): ShellCommand[] {
  const { t } = useTranslation();
  const { width, primaryExpanded, setPrimaryExpanded, focusPrimary } =
    useShellTier();
  const focus = useShellFocus();
  const workbench = useWorkbench();
  const panels = useWorkbenchPanels();
  const objects = useWorkbenchObjects();
  const commands: ShellCommand[] = [];
  function add(
    id: string,
    label: string,
    run: ShellCommand["run"],
    shortcut?: string,
  ) {
    commands.push({
      id: `workbench:${id}`,
      group: "actions",
      label: t(label),
      keywords: [],
      run,
      shortcut,
    });
  }
  if (panels.zen.before) {
    add("zen-exit", "shell.zen.exit", panels.exitZen, "Escape");
    return commands;
  }
  if (!workbench.pending && !workbench.error) {
    add("zen-enter", "shell.zen.enter", panels.enterZen);
    add("reset-layout", "settings.workbench.reset", async () => {
      await workbench.resetLayout();
    });
    add("primary-toggle", "shell.panels.primaryToggle", async () => {
      await setPrimaryExpanded(!primaryExpanded);
    });
    add("focus-primary", "shell.panels.focusPrimary", focusPrimary);
    if (panels.selected) {
      const asSheet = () =>
        auxiliaryLayout(panels.layout, width, true, false).asSheet;
      add("auxiliary-toggle", "shell.panels.toggle", () =>
        panels.toggle(asSheet()),
      );
      add("focus-auxiliary", "shell.panels.focusAuxiliary", async () => {
        if (asSheet()) panels.setSheet("auxiliary");
        else if (!panels.layout.visible)
          await workbench.updateAuxiliary({
            visible: true,
            panel: panels.selected?.id,
          });
        focus.focus("auxiliary");
      });
    }
  }
  add("focus-content", "shell.panels.focusContent", () => {
    panels.setSheet(null);
    focus.focus("content");
  });
  if (!objects.pending && objects.current) {
    const current = objects.current;
    const index = objects.entries.findIndex(
      (entry) => objectKey(entry.object.ref) === objectKey(current.object.ref),
    );
    for (const [id, label, step] of [
      ["object-previous", "shell.panels.previousObject", -1],
      ["object-next", "shell.panels.nextObject", 1],
    ] as const) {
      if (objects.entries.length > 1)
        add(id, label, () =>
          objects.activate(
            objects.entries[
              (index + step + objects.entries.length) % objects.entries.length
            ].object.ref,
          ),
        );
    }
    add("object-close", "shell.panels.closeObject", () =>
      objects.close(current.object.ref),
    );
    add("objects-close-all", "shell.objects.closeAll", objects.closeAll);
  }
  return commands;
}
