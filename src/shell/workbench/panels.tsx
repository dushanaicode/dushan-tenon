import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ModuleManifest, ObjectViewProps } from "@/core/contracts/module";
import { LazyContent } from "@/core/lazy-content";
import { routeOfPath } from "@/core/module-directory";
import { evaluateVisibility, type VisibilityAuth } from "@/core/visibility";
import {
  Button,
  Icon,
  PageHeadingLevelProvider,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/kit";
import { useShellEnvironment } from "../shell-context";
import { useShellFocus } from "../shell-focus";
import { dragRegion } from "../window/drag-region";
import { useWindowChrome } from "../window/window-chrome";
import { ConnectedWindowControls } from "../window/window-controls";
import { useWorkbenchObjects } from "./object-view";
import { objectContributions, objectKey } from "./objects";
import { useWorkbench } from "./store";
import { type OpenSheet, useZen } from "./zen";

export function panelContributions(modules: readonly ModuleManifest[]) {
  const entries = modules.flatMap((manifest) =>
    manifest.workbenchPanels.map((panel) => ({ manifest, panel })),
  );
  const ids = new Set<string>();
  for (const { panel } of entries) {
    if (!/^[a-z0-9-]{1,32}$/.test(panel.id) || ids.has(panel.id))
      throw new Error(`Invalid or duplicate workbench panel id: ${panel.id}`);
    ids.add(panel.id);
  }
  return entries.sort(
    (a, b) =>
      a.panel.order - b.panel.order ||
      (a.panel.id < b.panel.id ? -1 : a.panel.id > b.panel.id ? 1 : 0),
  );
}

export function accessiblePanels(
  entries: ReturnType<typeof panelContributions>,
  objects: ReturnType<typeof objectContributions>,
  enabled: ReadonlySet<string>,
  auth: VisibilityAuth,
) {
  return entries.filter(({ manifest, panel }) => {
    const provider = objects.find(
      ({ contribution }) => contribution.kind === panel.objectKind,
    );
    const route = provider
      ? routeOfPath(provider.manifest, provider.contribution.route)
      : undefined;
    return (
      enabled.has(manifest.id) &&
      provider !== undefined &&
      enabled.has(provider.manifest.id) &&
      route !== undefined &&
      evaluateVisibility(route, auth) === "visible" &&
      evaluateVisibility(panel, auth) === "visible"
    );
  });
}

function usePanelState() {
  const workbench = useWorkbench();
  const objects = useWorkbenchObjects();
  const { manifests, enabled, auth } = useShellEnvironment();
  const focus = useShellFocus();
  const registered = useMemo(() => panelContributions(manifests), [manifests]);
  const objectProviders = useMemo(
    () => objectContributions(manifests),
    [manifests],
  );
  const layout = workbench.snapshot.auxiliary;
  const available = accessiblePanels(
    registered,
    objectProviders,
    enabled,
    auth,
  );
  const object = objects.current?.object;
  const panels = object
    ? available.filter(({ panel }) => panel.objectKind === object.ref.kind)
    : [];
  const selected =
    panels.find(({ panel }) => panel.id === layout.panel)?.panel ??
    panels[0]?.panel;
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const [removed, setRemoved] = useState(0);
  const reported = useRef("");
  const zen = useZen();
  const blocked =
    workbench.pending || workbench.error !== null || zen.before !== null;

  useEffect(() => {
    if (workbench.pending || workbench.error) return;
    if (
      layout.panel === null ||
      available.some(({ panel }) => panel.id === layout.panel)
    )
      return;
    if (reported.current !== layout.panel) {
      reported.current = layout.panel;
      setRemoved(1);
    }
    void workbench.updateAuxiliary({ panel: null });
  }, [available, layout.panel, workbench]);

  useEffect(() => {
    if (!selected && sheet === "auxiliary") setSheet(null);
  }, [selected, sheet]);

  function restoreSheetFocus(closed: Exclude<OpenSheet, null>) {
    if (zen.before) {
      focus.focus("zenExit");
      return;
    }
    const destination = sheetRef.current;
    focus.focus(
      destination ??
        (closed === "primary" ? "primaryTrigger" : "auxiliaryTrigger"),
    );
  }
  return {
    layout,
    object,
    selected,
    panels,
    removed,
    blocked,
    sheet,
    setSheet,
    restoreSheetFocus,
    zen,
    enterZen: () => {
      zen.enter({ sheet });
      setSheet(null);
      focus.focus("zenExit");
    },
    exitZen: () => {
      const before = zen.exit();
      if (before) setSheet(before.sheet);
    },
    toggle: (asSheet: boolean) => {
      if (!selected || blocked) return;
      if (asSheet) setSheet(sheet === "auxiliary" ? null : "auxiliary");
      else
        void workbench.updateAuxiliary({
          visible: !layout.visible,
          panel: selected.id,
        });
    },
    select: (panel: string) => {
      if (panels.some((entry) => entry.panel.id === panel))
        void workbench.updateAuxiliary({ panel });
    },
    unavailable: () => {
      if (object) objects.unavailable(object.ref);
    },
  };
}

const Panels = createContext<ReturnType<typeof usePanelState> | null>(null);

export function WorkbenchPanelsProvider({ children }: { children: ReactNode }) {
  const value = usePanelState();
  return <Panels.Provider value={value}>{children}</Panels.Provider>;
}

export function useWorkbenchPanels() {
  const context = useContext(Panels);
  if (!context) throw new Error("WorkbenchPanelsProvider is required");
  return context;
}

export function AuxiliaryToggle({ asSheet }: { asSheet: boolean }) {
  const panels = useWorkbenchPanels();
  const { t } = useTranslation();
  const focus = useShellFocus();
  if (!panels.selected || panels.zen.before) return null;
  return (
    <Button
      ref={focus.auxiliaryTrigger}
      data-workbench-auxiliary-trigger
      data-as-sheet={asSheet}
      variant="ghost"
      size="icon"
      aria-label={t("shell.panels.toggle")}
      aria-expanded={
        asSheet ? panels.sheet === "auxiliary" : panels.layout.visible
      }
      disabled={panels.blocked}
      onClick={() => panels.toggle(asSheet)}
    >
      <Icon iconId={panels.selected.iconId} />
    </Button>
  );
}

function CurrentPanel({
  Component,
}: {
  Component: ComponentType<ObjectViewProps>;
}) {
  const panels = useWorkbenchPanels();
  return panels.object ? (
    <Component object={panels.object} onUnavailable={panels.unavailable} />
  ) : null;
}

export function AuxiliaryContent({ asSheet }: { asSheet: boolean }) {
  const panels = useWorkbenchPanels();
  const { t } = useTranslation();
  const selected = panels.selected;
  const focus = useShellFocus();
  const factory = useMemo(
    () => async () => {
      if (!selected) throw new Error("A selected panel is required");
      const { default: Component } = await selected.Component();
      return { default: () => <CurrentPanel Component={Component} /> };
    },
    [selected],
  );
  if (!selected || !panels.object) return null;
  return (
    <aside
      ref={focus.auxiliary}
      data-shell="auxiliary"
      data-workbench-auxiliary
      tabIndex={-1}
      aria-label={t(selected.labelKey)}
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
    >
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
        {panels.panels.length > 1 ? (
          <Select
            value={selected.id}
            onValueChange={panels.select}
            disabled={panels.blocked}
          >
            <SelectTrigger aria-label={t("shell.panels.select")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {panels.panels.map(({ panel }) => (
                <SelectItem key={panel.id} value={panel.id}>
                  {t(panel.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-body font-semibold">
            {t(selected.labelKey)}
          </h2>
        )}
        {!asSheet && (
          <Button
            variant="ghost"
            size="icon"
            disabled={panels.blocked}
            aria-label={t("shell.panels.close")}
            onClick={() => panels.toggle(false)}
          >
            <Icon iconId="close" />
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1 p-4">
        <PageHeadingLevelProvider level={2}>
          <LazyContent
            key={`${selected.id}:${objectKey(panels.object.ref)}`}
            factory={factory}
          />
        </PageHeadingLevelProvider>
      </ScrollArea>
    </aside>
  );
}

export function AuxiliarySheet({ side }: { side: "left" | "right" }) {
  const panels = useWorkbenchPanels();
  const { t } = useTranslation();
  return (
    <Sheet
      open={
        panels.sheet === "auxiliary" &&
        panels.selected !== undefined &&
        !panels.zen.before
      }
      onOpenChange={(open) => panels.setSheet(open ? "auxiliary" : null)}
    >
      <SheetContent
        side={side}
        aria-describedby={undefined}
        className="w-80 gap-0 p-0"
        style={{ width: panels.layout.width, maxWidth: "100vw" }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          panels.restoreSheetFocus("auxiliary");
        }}
      >
        <SheetTitle className="sr-only">{t("shell.panels.title")}</SheetTitle>
        <AuxiliaryContent asSheet />
      </SheetContent>
    </Sheet>
  );
}

export function PanelFeedback() {
  const panels = useWorkbenchPanels();
  const { t } = useTranslation();
  return (
    <>
      {panels.removed > 0 && (
        <p role="status">
          {t("shell.panels.removed", { count: panels.removed })}
        </p>
      )}
    </>
  );
}

export function ZenExit() {
  const { titlebar } = useWindowChrome();
  const panels = useWorkbenchPanels();
  const { t } = useTranslation();
  const focus = useShellFocus();
  if (panels.zen.before && titlebar === "hidden") {
    return (
      <header
        {...dragRegion(titlebar)}
        data-shell="zen-titlebar"
        className="flex h-9 shrink-0 items-center justify-end gap-2"
      >
        <Button
          ref={focus.zenExit}
          data-zen-exit
          variant="ghost"
          className="h-full focus-visible:-outline-offset-4!"
          onClick={panels.exitZen}
        >
          {t("shell.zen.exit")}
        </Button>
        <ConnectedWindowControls />
      </header>
    );
  }
  return panels.zen.before ? (
    <Button
      ref={focus.zenExit}
      data-zen-exit
      variant="outline"
      className="m-2 self-end"
      onClick={panels.exitZen}
    >
      {t("shell.zen.exit")}
    </Button>
  ) : null;
}
