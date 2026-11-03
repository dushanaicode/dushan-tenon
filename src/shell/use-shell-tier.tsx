import {
  createContext,
  type ReactNode,
  type RefCallback,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { type Tier, tierForWidth } from "@/kit";
import type { WorkbenchLayoutChange } from "@/lib/generated/WorkbenchLayoutChange";
import type { WorkbenchSnapshot } from "@/lib/generated/WorkbenchSnapshot";
import { useShellFocus } from "./shell-focus";
import { useWorkbenchPanels } from "./workbench/panels";
import { useWorkbench } from "./workbench/store";

const Context = createContext<{
  tier: Tier;
  width: number;
  container: RefCallback<HTMLDivElement>;
  layouts: WorkbenchSnapshot["layouts"];
  saveLayout: (layout: WorkbenchLayoutChange) => Promise<boolean>;
  primaryExpanded: boolean;
  setPrimaryExpanded: (expanded: boolean) => Promise<boolean>;
  focusPrimary: () => Promise<void>;
} | null>(null);

export function ShellTierProvider({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(0);
  const tier = tierForWidth(width);
  const workbench = useWorkbench();
  const panels = useWorkbenchPanels();
  const focus = useShellFocus();
  const [submitting, setSubmitting] = useState<WorkbenchLayoutChange | null>(
    null,
  );
  const [mediumExpanded, setMediumExpanded] = useState(false);
  const layouts = submitting ?? workbench.snapshot.layouts;
  const primaryExpanded =
    panels.zen.before === null &&
    (tier === "compact"
      ? panels.sheet === "primary"
      : tier === "medium"
        ? mediumExpanded
        : !layouts.console.primaryCollapsed);
  useLayoutEffect(() => {
    if (tier !== "medium") setMediumExpanded(false);
  }, [tier]);
  async function saveLayout(layout: WorkbenchLayoutChange) {
    setSubmitting(layout);
    const saved = await workbench.updateLayout(layout);
    setSubmitting(null);
    return saved;
  }
  async function setPrimaryExpanded(expanded: boolean) {
    if (tier === "compact") {
      panels.setSheet(expanded ? "primary" : null);
      return true;
    }
    if (tier === "medium") {
      setMediumExpanded(expanded);
      return true;
    }
    if (expanded === primaryExpanded) return true;
    return saveLayout({
      console: { ...layouts.console, primaryCollapsed: !expanded },
    });
  }
  const container = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <Context
      value={{
        tier,
        width,
        container,
        layouts,
        saveLayout,
        primaryExpanded,
        setPrimaryExpanded,
        focusPrimary: async () => {
          if (await setPrimaryExpanded(true)) focus.focus("primary");
        },
      }}
    >
      {children}
    </Context>
  );
}
export function useShellTier() {
  const value = useContext(Context);
  if (!value) throw new Error("ShellTierProvider is required");
  return value;
}
