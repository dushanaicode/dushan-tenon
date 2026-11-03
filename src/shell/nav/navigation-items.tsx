import { Fragment, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Badge,
  Icon,
  Kbd,
  NavGroupLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/kit";
import { cn } from "@/lib/utils";
import type {
  ActiveNavItem,
  NavBase,
  NavItem,
  NavLeaf,
  NavParent,
} from "../nav-tree";
import { formatShortcut } from "../shortcuts";
import type { NavExpansion } from "./expansion";
import { useHoverIntent } from "./use-hover-intent";

export type NavigationItemsProps = NavExpansion & {
  items: readonly NavItem[];
  active: ActiveNavItem | undefined;
  collapsed: boolean;
  side: "left" | "right";
  onNavigate?: () => void;
};

const itemClass = cn(
  "relative flex h-control w-full shrink-0 items-center gap-3 rounded-lg text-body text-muted-foreground",
  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-sidebar-primary",
);

function NavMeta({
  item,
  parent = false,
  id,
  collapsed = false,
}: {
  item: NavBase;
  parent?: boolean;
  id?: string;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span
      id={id}
      data-part="nav-meta"
      className={collapsed ? "sr-only" : undefined}
    >
      {item.badge &&
        (item.badge.kind === "count" ? (
          <Badge>{item.badge.value}</Badge>
        ) : (
          <span>{t(item.badge.labelKey)}</span>
        ))}
      {item.shortcut && <Kbd>{formatShortcut(item.shortcut)}</Kbd>}
      {parent && <Icon iconId="expand" data-part="nav-arrow" />}
    </span>
  );
}

function NavigationLeaf({
  item,
  active,
  collapsed,
  child = false,
  side,
  onNavigate,
  elementRef,
}: {
  item: NavLeaf;
  active: ActiveNavItem | undefined;
  collapsed: boolean;
  child?: boolean;
  elementRef?: (element: HTMLAnchorElement | null) => undefined | (() => void);
  side: "left" | "right";
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const metaId = useId();
  const current = active?.item.id === item.id;
  const face = (
    <>
      {current && (
        <span
          data-part="active-indicator"
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.75 rounded-r bg-primary"
        />
      )}
      <Icon iconId={item.iconId} data-nav-icon={collapsed ? "icon" : "text"} />
      <span
        data-motion-item
        data-part="label"
        className={cn(
          "motion-opacity min-w-0 truncate",
          collapsed && "sr-only opacity-0",
        )}
      >
        {t(item.label)}
      </span>
      <NavMeta id={metaId} item={item} collapsed={collapsed} />
    </>
  );
  const link = (
    <Link
      ref={elementRef}
      data-shell="nav-item"
      data-nav-kind={child ? "child" : "leaf"}
      to={item.path}
      aria-label={t(item.label)}
      aria-describedby={item.badge || item.shortcut ? metaId : undefined}
      aria-current={current ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        itemClass,
        collapsed ? "justify-center px-0" : "justify-start px-3",
      )}
    >
      {face}
    </Link>
  );
  return (
    <Tooltip open={collapsed && tooltipOpen} onOpenChange={setTooltipOpen}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={side === "left" ? "right" : "left"}>
        {t(item.label)}
        <NavMeta item={item} />
      </TooltipContent>
    </Tooltip>
  );
}

function NavigationChildren({
  parent,
  leaves,
  active,
  side,
  onNavigate,
}: {
  parent: NavParent;
  leaves?: Map<string, HTMLAnchorElement>;
  active: ActiveNavItem | undefined;
  side: "left" | "right";
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return parent.children.map((item) => (
    <Fragment key={item.id}>
      {item.sectionLabel && (
        <NavGroupLabel>{t(item.sectionLabel)}</NavGroupLabel>
      )}
      <NavigationLeaf
        item={item}
        elementRef={
          leaves
            ? (element) => {
                if (element) leaves.set(item.id, element);
                return () => {
                  leaves.delete(item.id);
                };
              }
            : undefined
        }
        active={active}
        collapsed={false}
        child
        side={side}
        onNavigate={onNavigate}
      />
    </Fragment>
  ));
}

function NavigationParent({
  item,
  active,
  expanded,
  toggle,
  collapsed,
  side,
  onNavigate,
}: Omit<NavigationItemsProps, "items"> & { item: NavParent }) {
  const { t } = useTranslation();
  const childrenId = useId();
  const metaId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const leaves = useRef(new Map<string, HTMLAnchorElement>());
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const hover = useHoverIntent(setFlyoutOpen, content, collapsed);
  const open = collapsed ? flyoutOpen : expanded.has(item.id);
  const focusFirst = () => leaves.current.get(item.children[0].id)?.focus();
  const button = (
    <button
      ref={trigger}
      type="button"
      data-shell="nav-item"
      data-nav-kind="parent"
      data-ancestor-current={
        active?.parent?.id === item.id ? "true" : undefined
      }
      data-state={open ? "open" : "closed"}
      aria-expanded={open}
      aria-controls={childrenId}
      aria-describedby={item.badge || item.shortcut ? metaId : undefined}
      aria-label={
        collapsed
          ? t("shell.nav.openChildren", { name: t(item.label) })
          : t(item.label)
      }
      className={cn(itemClass, collapsed ? "justify-center px-0" : "px-3")}
      onClick={() => {
        if (!collapsed) toggle(item.id);
        else {
          hover.cancel();
          focusOnOpen.current = true;
        }
      }}
      onPointerEnter={
        collapsed
          ? (event) => {
              focusOnOpen.current = false;
              hover.enterTrigger(event);
            }
          : undefined
      }
      onPointerLeave={collapsed ? hover.leave : undefined}
      onKeyDown={
        collapsed
          ? (event) => {
              if (event.key !== "Enter" && event.key !== "ArrowRight") return;
              event.preventDefault();
              hover.cancel();
              focusOnOpen.current = true;
              if (open) focusFirst();
              else setFlyoutOpen(true);
            }
          : undefined
      }
    >
      <Icon iconId={item.iconId} data-nav-icon={collapsed ? "icon" : "text"} />
      <span
        data-part="label"
        className={cn("min-w-0 truncate", collapsed && "sr-only")}
      >
        {t(item.label)}
      </span>
      <NavMeta
        id={metaId}
        item={item}
        parent={!collapsed}
        collapsed={collapsed}
      />
    </button>
  );
  if (!collapsed)
    return (
      <div>
        {button}
        <div id={childrenId} data-part="nav-children" hidden={!open}>
          <NavigationChildren
            parent={item}
            leaves={leaves.current}
            active={active}
            side={side}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    );
  return (
    <Popover
      open={flyoutOpen}
      onOpenChange={(value) => {
        hover.cancel();
        setFlyoutOpen(value);
      }}
    >
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        ref={content}
        id={childrenId}
        data-shell="nav-flyout"
        aria-label={t(item.label)}
        side={side === "left" ? "right" : "left"}
        align="start"
        sideOffset={0}
        className="p-0"
        onPointerEnter={hover.enterContent}
        onPointerLeave={hover.leave}
        onFocusCapture={hover.cancel}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (focusOnOpen.current) focusFirst();
        }}
        onEscapeKeyDown={() => {
          focusOnOpen.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (focusOnOpen.current) trigger.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const elements = item.children.flatMap((leaf) => {
            const element = leaves.current.get(leaf.id);
            return element ? [element] : [];
          });
          const index = elements.indexOf(
            document.activeElement as HTMLAnchorElement,
          );
          const next =
            event.key === "ArrowDown"
              ? (index + 1) % elements.length
              : event.key === "ArrowUp"
                ? (index - 1 + elements.length) % elements.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? elements.length - 1
                    : undefined;
          if (next !== undefined) {
            event.preventDefault();
            elements[next].focus();
          } else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const nextLeaf = [
              ...elements.slice(index + 1),
              ...elements.slice(0, index + 1),
            ].find((leaf) =>
              leaf
                .getAttribute("aria-label")
                ?.toLocaleLowerCase()
                .startsWith(event.key.toLocaleLowerCase()),
            );
            if (nextLeaf) {
              event.preventDefault();
              nextLeaf.focus();
            }
          }
        }}
      >
        <ScrollArea className="max-h-(--radix-popover-content-available-height) p-2">
          <nav aria-label={t(item.label)}>
            <NavigationChildren
              parent={item}
              leaves={leaves.current}
              active={active}
              side={side}
              onNavigate={() => {
                focusOnOpen.current = false;
                setFlyoutOpen(false);
                onNavigate?.();
              }}
            />
          </nav>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function NavigationItems({ items, ...props }: NavigationItemsProps) {
  return items.map((item) =>
    item.kind === "leaf" ? (
      <NavigationLeaf key={item.id} item={item} {...props} />
    ) : (
      <NavigationParent key={item.id} item={item} {...props} />
    ),
  );
}
