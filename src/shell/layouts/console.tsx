import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import {
  Button,
  Icon,
  NavGroupLabel,
  ResizableGroup,
  type ResizableGroupHandle,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  usePageTitleFocus,
} from "@/kit";
import {
  AUXILIARY_LAYOUT_LIMITS,
  CONSOLE_LAYOUT_LIMITS,
} from "@/lib/generated/workbench";
import { cn } from "@/lib/utils";
import { CommandPaletteTrigger } from "../command-palette";
import { useNavExpansion } from "../nav/expansion";
import {
  NavigationItems,
  type NavigationItemsProps,
} from "../nav/navigation-items";
import { findActiveItem, type NavTree } from "../nav-tree";
import type { ShellProps } from "../shell";
import { useShellFocus } from "../shell-focus";
import { useShellTier } from "../use-shell-tier";
import { dragRegion } from "../window/drag-region";
import { useWindowChrome } from "../window/window-chrome";
import { ConnectedWindowControls } from "../window/window-controls";
import {
  auxiliaryLayout,
  CONTENT_MIN_WIDTH,
  consoleLayout,
  panelSizes,
  requestedAuxiliaryLayout,
  requestedConsoleLayout,
  SEPARATOR_WIDTH,
} from "../workbench/layout";
import {
  AuxiliaryContent,
  AuxiliaryToggle,
  useWorkbenchPanels,
  ZenExit,
} from "../workbench/panels";
import { useWorkbench } from "../workbench/store";

function Navigation({
  tree,
  collapsed,
  toggleButton,
  onNavigate,
  ...navigation
}: {
  tree: NavTree;
  collapsed: boolean;
  toggleButton?: ReactNode;
  onNavigate?: () => void;
} & Omit<NavigationItemsProps, "items" | "collapsed" | "onNavigate">) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("app.navigation")}
      className="flex min-h-0 flex-1 flex-col gap-stack px-3 pb-3"
    >
      <ScrollArea className="min-h-0 py-1">
        {tree.groups.map((group) => (
          <div key={group.id} className="mb-6 space-y-1">
            {group.label && (
              <NavGroupLabel
                data-motion-item
                className={cn(
                  "motion-opacity overflow-hidden whitespace-nowrap",
                  collapsed && "opacity-0",
                )}
              >
                {t(group.label)}
              </NavGroupLabel>
            )}
            <NavigationItems
              {...navigation}
              items={group.items}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </div>
        ))}
      </ScrollArea>
      <div className="mt-auto shrink-0 space-y-1 border-t border-border pt-3">
        <NavigationItems
          {...navigation}
          items={tree.footer}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        {toggleButton}
      </div>
    </nav>
  );
}

export function ConsoleLayout({
  tree,
  slots,
  children,
  objectTabs,
}: ShellProps) {
  const { titlebar } = useWindowChrome();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const panels = useWorkbenchPanels();
  const zen = panels.zen.before !== null;
  const { container, tier, primaryExpanded, setPrimaryExpanded } =
    useShellTier();
  const narrow = tier === "compact";
  const collapsed = !primaryExpanded;
  const side = "left";
  const focus = useShellFocus();
  const focusTitle = usePageTitleFocus();
  const navigating = useRef(false);
  const open = panels.sheet === "primary" && !zen;
  const setOpen = (value: boolean) => {
    void setPrimaryExpanded(value);
  };
  const sidebarId = useId();
  const active = findActiveItem(tree, pathname);
  const expansion = useNavExpansion();
  const resize = useConsoleResize();
  const { auxiliary, primaryWidth, showPrimary, sizes, pending } = resize;
  useEffect(() => {
    if (!narrow && panels.sheet === "primary") panels.setSheet(null);
    if (!auxiliary.asSheet && panels.sheet === "auxiliary")
      panels.setSheet(null);
  }, [narrow, auxiliary.asSheet, panels]);
  const toggle = () => {
    void setPrimaryExpanded(!primaryExpanded);
  };
  const toggleLabel = t(
    collapsed ? "shell.sidebar.expand" : "shell.sidebar.collapse",
  );
  // Compact 32px target and 16px glyph, independent of theme icon density.
  const toggleButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-shell="sidebar-toggle"
          variant="ghost"
          size="icon"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls={sidebarId}
          className={cn(
            "size-8 shrink-0 rounded-md text-muted-foreground",
            collapsed && "mx-auto flex",
          )}
          onClick={toggle}
          disabled={pending}
        >
          <Icon
            iconId={collapsed ? "sidebar-expand" : "sidebar-collapse"}
            className="size-4"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{toggleLabel}</TooltipContent>
    </Tooltip>
  );
  const sidebar = showPrimary && (
    <ResizablePanel
      key="primary"
      id="primary"
      defaultSize={primaryWidth}
      minSize={CONSOLE_LAYOUT_LIMITS.min}
      maxSize={CONSOLE_LAYOUT_LIMITS.max}
      collapsible
      collapsedSize={CONSOLE_LAYOUT_LIMITS.collapsed}
      groupResizeBehavior="preserve-pixel-size"
    >
      <aside
        data-shell="sidebar"
        ref={focus.primary}
        id={sidebarId}
        data-workbench-primary
        tabIndex={-1}
        data-collapsed={collapsed}
        className="group/sidebar flex h-full flex-col bg-sidebar"
      >
        <div className="appearance-brand flex h-16 shrink-0 items-center gap-3 overflow-hidden px-4">
          {slots.brand}
        </div>
        <Navigation
          onNavigate={focusTitle}
          {...expansion}
          active={active}
          side={side}
          tree={tree}
          collapsed={collapsed}
          toggleButton={toggleButton}
        />
      </aside>
    </ResizablePanel>
  );
  const separator = showPrimary && (
    <ResizableHandle
      key="separator"
      data-workbench-resize="primary"
      aria-label={t("settings.workbench.resize")}
    />
  );
  const auxiliaryPanel = auxiliary.docked && (
    <ResizablePanel
      key="auxiliary"
      id="auxiliary"
      defaultSize={auxiliary.width}
      minSize={AUXILIARY_LAYOUT_LIMITS.min}
      maxSize={AUXILIARY_LAYOUT_LIMITS.max}
      collapsible
      collapsedSize={0}
      groupResizeBehavior="preserve-pixel-size"
    >
      <AuxiliaryContent asSheet={false} />
    </ResizablePanel>
  );
  const auxiliarySeparator = auxiliary.docked && (
    <ResizableHandle
      key="auxiliary-separator"
      elementRef={resize.auxiliaryHandle}
      data-workbench-resize="auxiliary"
      aria-label={t("shell.panels.resize")}
    />
  );
  const header = !zen && (
    <header
      data-shell="topbar"
      {...dragRegion(titlebar)}
      className={cn(
        "flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border px-6",
        titlebar === "hidden" && "pr-0",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {narrow && (
          <SheetTrigger asChild>
            <Button
              data-shell="sidebar-toggle"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={t("shell.sidebar.open")}
              ref={focus.primaryTrigger}
              data-workbench-primary-trigger
            >
              <Icon iconId="menu" />
            </Button>
          </SheetTrigger>
        )}
        <span data-part="title" className="truncate text-body font-semibold">
          {t(active ? active.item.label : "app.name")}
        </span>
        <span aria-hidden="true" className="min-w-0 flex-1 self-stretch" />
      </div>
      <CommandPaletteTrigger />
      <div className="flex shrink-0 items-center gap-1">
        <AuxiliaryToggle asSheet={auxiliary.asSheet} />
        {slots.headerEnd}
      </div>
      <ConnectedWindowControls />
    </header>
  );
  const content = (
    <ResizablePanel
      key="content"
      id="content"
      minSize={narrow ? 0 : CONTENT_MIN_WIDTH}
    >
      <div className="flex h-full min-w-0 flex-col">
        <ZenExit />
        {header}
        {objectTabs}
        <ScrollArea
          role="main"
          region="content"
          data-shell="content"
          ref={focus.content}
          tabIndex={-1}
          className="grid min-h-0 flex-1"
          plateClassName="appearance-content workbench-content"
        >
          {children}
        </ScrollArea>
      </div>
    </ResizablePanel>
  );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div
        ref={container}
        data-shell="root"
        data-shell-tier={tier}
        data-workbench-container
        className={cn(
          "@container/shell flex h-dvh overflow-hidden bg-background text-foreground",
        )}
      >
        <ResizableGroup
          className="min-h-0 flex-1"
          disableCursor
          groupRef={resize.group}
          defaultLayout={sizes}
          orientation="horizontal"
          disabled={pending || tier !== "expanded"}
          {...resize.handlers}
        >
          {[sidebar, separator, content, auxiliarySeparator, auxiliaryPanel]}
        </ResizableGroup>
        <SheetContent
          data-shell="sidebar"
          ref={focus.primary}
          data-workbench-primary
          tabIndex={-1}
          side={side}
          aria-describedby={undefined}
          className="w-56 gap-0 bg-sidebar p-0 text-sidebar-foreground"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (navigating.current) {
              navigating.current = false;
              focusTitle();
            } else panels.restoreSheetFocus("primary");
          }}
        >
          <SheetTitle className="sr-only">{t("app.navigation")}</SheetTitle>
          <div
            className={cn(
              "flex h-16 shrink-0 items-center gap-3 overflow-hidden",
              "px-4 pr-12",
              "[&>span:last-child]:min-w-0 [&>span:last-child]:truncate",
            )}
          >
            {slots.brand}
          </div>
          <Navigation
            {...expansion}
            active={active}
            side={side}
            tree={tree}
            collapsed={false}
            onNavigate={() => {
              navigating.current = true;
              setOpen(false);
            }}
          />
        </SheetContent>
      </div>
    </Sheet>
  );
}

function useConsoleResize() {
  const workbench = useWorkbench();
  const panels = useWorkbenchPanels();
  const { width, tier, layouts, saveLayout, primaryExpanded } = useShellTier();
  const requested = layouts.console;
  const narrow = tier === "compact";
  const collapsed = !primaryExpanded;
  const zen = panels.zen.before !== null;
  const group = useRef<ResizableGroupHandle>(null);
  const resizingAuxiliary = useRef(false);
  const auxiliaryHandle = useRef<HTMLDivElement>(null);
  const auxiliary = auxiliaryLayout(
    panels.layout,
    width,
    panels.selected !== undefined,
    zen,
  );
  const { primaryWidth } = consoleLayout(
    { ...requested, primaryCollapsed: collapsed },
    auxiliary.availableWidth,
  );
  const showPrimary = !narrow && !zen;
  const sizes = useMemo(
    () =>
      panelSizes(
        width,
        showPrimary ? primaryWidth : null,
        auxiliary.docked ? auxiliary.width : null,
      ),
    [width, showPrimary, primaryWidth, auxiliary.docked, auxiliary.width],
  );
  const pending =
    workbench.pending || workbench.error?.code === "app.workbench.conflict";
  const restoreLayout = useCallback(() => {
    if (pending || width === 0) return;
    const registered = group.current?.getLayout();
    if (
      !registered ||
      Object.keys(registered).length !== Object.keys(sizes).length
    )
      return;
    group.current?.setLayout(sizes);
  }, [sizes, width, pending]);
  useEffect(restoreLayout, [restoreLayout]);

  const handlers: Pick<
    import("@/kit").ResizableGroupProps,
    | "onLayoutChanged"
    | "onPointerDownCapture"
    | "onKeyDownCapture"
    | "onUserLayoutChange"
  > = {
    onLayoutChanged: (_layout, meta) => {
      // Registration can restore cached proportions after the effect ran.
      if (!meta.isUserInteraction) restoreLayout();
    },
    onPointerDownCapture: (event) => {
      // The library focuses the hit-tested separator in document capture.
      // Its expanded hit area can start inside an adjacent panel.
      resizingAuxiliary.current =
        event.currentTarget.ownerDocument.activeElement ===
        auxiliaryHandle.current;
    },
    onKeyDownCapture: (event) => {
      resizingAuxiliary.current =
        event.target instanceof Node &&
        auxiliaryHandle.current?.contains(event.target) === true;
    },
    onUserLayoutChange: (layout) => {
      if (zen || pending || tier !== "expanded") return;
      const usable =
        width -
        (Number(showPrimary) + Number(auxiliary.docked)) * SEPARATOR_WIDTH;
      if (resizingAuxiliary.current && auxiliary.docked) {
        const next = requestedAuxiliaryLayout(
          (layout.auxiliary / 100) * usable,
          panels.layout,
        );
        if (
          next.width !== panels.layout.width ||
          next.visible !== panels.layout.visible
        )
          void workbench.updateAuxiliary(next);
        return;
      }
      const next = requestedConsoleLayout(
        (layout.primary / 100) * usable,
        requested,
      );
      if (
        next.primaryWidth !== requested.primaryWidth ||
        next.primaryCollapsed !== requested.primaryCollapsed
      )
        void saveLayout({ console: next });
    },
  };
  return {
    auxiliary,
    primaryWidth,
    showPrimary,
    sizes,
    pending,
    group,
    auxiliaryHandle,
    handlers,
  };
}
