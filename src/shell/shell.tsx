import { type ReactNode, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { SettingSection } from "@/core/contracts/settings";
import { useKeyboardSettings } from "@/core/keyboard-settings";
import { PageTitleFocusProvider, usePageTitleFocus } from "@/kit";
import { CommandPalette, CommandPaletteProvider } from "./command-palette";
import { useShellCommands } from "./commands";
import { ConsoleLayout } from "./layouts/console";
import { NavExpansionProvider } from "./nav/expansion";
import type { NavTree } from "./nav-tree";
import { PageTransition } from "./page-transition";
import {
  type ShellEnvironment,
  ShellEnvironmentProvider,
} from "./shell-context";
import { ShellFocusProvider } from "./shell-focus";
import { ShellTierProvider } from "./use-shell-tier";
import { ObjectTabs } from "./workbench/object-tabs";
import { ObjectView, WorkbenchObjectsProvider } from "./workbench/object-view";
import {
  AuxiliarySheet,
  PanelFeedback,
  WorkbenchPanelsProvider,
} from "./workbench/panels";
import { WorkbenchFeedback, WorkbenchProvider } from "./workbench/store";

export type ShellSlots = { brand: ReactNode; headerEnd: ReactNode };
export type ShellProps = {
  tree: NavTree;
  slots: ShellSlots;
  children: ReactNode;
  objectTabs?: ReactNode;
};
export type ShellRootProps = Omit<ShellProps, "objectTabs"> &
  ShellEnvironment & { sections: readonly SettingSection[] };

/** App supplies the registry and the current visibility decision inputs. */
export function Shell(props: ShellRootProps) {
  return (
    <ShellEnvironmentProvider value={props}>
      <WorkbenchProvider userId={props.userId}>
        <ShellSession key={props.userId} {...props} />
      </WorkbenchProvider>
    </ShellEnvironmentProvider>
  );
}

function ShellSession(props: ShellRootProps) {
  return (
    <ShellFocusProvider>
      <PageTitleFocusProvider>
        <WorkbenchObjectsProvider userId={props.userId}>
          <WorkbenchPanelsProvider>
            <ShellTierProvider>
              <ShellContent {...props} />
            </ShellTierProvider>
          </WorkbenchPanelsProvider>
        </WorkbenchObjectsProvider>
      </PageTitleFocusProvider>
    </ShellFocusProvider>
  );
}

function ShellContent(props: ShellRootProps) {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const focusTitle = usePageTitleFocus();
  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      focusTitle();
    }
  }, [pathname, focusTitle]);
  const commands = useShellCommands(props.tree, props.sections);
  const keyboard = useKeyboardSettings();
  return (
    <CommandPaletteProvider
      commands={commands}
      bindings={keyboard.query.data?.snapshot.bindings}
      shortcutsReady={keyboard.query.isSuccess}
    >
      <NavExpansionProvider tree={props.tree}>
        <ConsoleLayout {...props} objectTabs={<ObjectTabs />}>
          <WorkbenchFeedback />
          <PanelFeedback />
          <PageTransition>
            <ObjectView>{props.children}</ObjectView>
          </PageTransition>
        </ConsoleLayout>
        <AuxiliarySheet side="right" />
        <CommandPalette />
      </NavExpansionProvider>
    </CommandPaletteProvider>
  );
}
