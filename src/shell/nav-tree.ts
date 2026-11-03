import type { ModuleManifest } from "@/core/contracts/module";
import type { NavBadge } from "@/core/contracts/navigation";
import { evaluateVisibility, type VisibilityAuth } from "@/core/visibility";
import type { IconId } from "@/kit";

export type { NavBadge } from "@/core/contracts/navigation";

export type NavBase = {
  id: string;
  label: string;
  iconId: IconId;
  badge?: NavBadge;
  shortcut?: string;
};
export type NavLeaf = NavBase & {
  kind: "leaf";
  path: string;
  children?: never;
  sectionLabel?: string;
};
export type NavParent = NavBase & {
  kind: "parent";
  path?: never;
  children: readonly [NavLeaf, ...NavLeaf[]];
};
export type NavItem = NavLeaf | NavParent;
export type NavGroup = { id: string; label?: string; items: NavItem[] };
export type NavTree = { groups: NavGroup[]; footer: NavLeaf[] };
export type ActiveNavItem = {
  item: NavLeaf;
  parent?: NavParent;
  groupId: string;
};

const ascii = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildNavTree(
  manifests: readonly ModuleManifest[],
  enabled: ReadonlySet<string> | undefined,
  auth: VisibilityAuth | undefined,
): NavTree {
  const items: NavItem[] = [
    { kind: "leaf", id: "home", path: "/", label: "nav.home", iconId: "home" },
  ];
  const developer: (NavItem & { order: number })[] = [];
  for (const manifest of manifests) {
    if (!enabled?.has(manifest.id) || !auth) continue;
    for (const item of manifest.nav) {
      if (item.kind === "leaf") {
        if (evaluateVisibility(item, auth) === "visible") items.push(item);
      } else {
        const [first, ...rest] = item.children.filter(
          (leaf) => evaluateVisibility(leaf, auth) === "visible",
        );
        if (first) items.push({ ...item, children: [first, ...rest] });
      }
    }
    const children = new Map<string, (NavLeaf & { order: number })[]>();
    for (const page of manifest.devPages) {
      if (
        !page.nav ||
        evaluateVisibility({ ...page, developerOnly: true }, auth) !== "visible"
      )
        continue;
      const leaf: NavLeaf & { order: number } = {
        kind: "leaf",
        id: page.nav.id,
        path: page.path,
        label: page.nav.labelKey,
        iconId: page.nav.iconId,
        order: page.nav.order,
        sectionLabel: page.nav.sectionLabelKey,
      };
      if (page.nav.parentId) {
        const siblings = children.get(page.nav.parentId) ?? [];
        siblings.push(leaf);
        children.set(page.nav.parentId, siblings);
      } else developer.push(leaf);
    }
    for (const parent of manifest.devNavParents ?? []) {
      const leaves = children.get(parent.id);
      if (!leaves) continue;
      leaves.sort((a, b) => a.order - b.order || ascii(a.path, b.path));
      let section: string | undefined;
      const [first, ...rest] = leaves.map((leaf) => {
        const sectionLabel =
          leaf.sectionLabel !== section ? leaf.sectionLabel : undefined;
        section = leaf.sectionLabel;
        return { ...leaf, sectionLabel };
      });
      if (first)
        developer.push({
          kind: "parent",
          id: parent.id,
          label: parent.labelKey,
          iconId: parent.iconId,
          order: parent.order,
          children: [first, ...rest],
        });
    }
  }
  developer.sort((a, b) => a.order - b.order || ascii(a.id, b.id));
  const groups: NavGroup[] = [{ id: "host", items }];
  if (developer.length > 0)
    groups.push({ id: "developer", label: "nav.developer", items: developer });
  return {
    groups,
    footer: [
      {
        kind: "leaf",
        id: "settings",
        path: "/settings",
        label: "nav.settings",
        iconId: "settings",
      },
    ],
  };
}

export function navLeaves(tree: NavTree): ActiveNavItem[] {
  return [
    ...tree.groups.flatMap((group) =>
      group.items.flatMap((item): ActiveNavItem[] =>
        item.kind === "leaf"
          ? [{ item, groupId: group.id }]
          : item.children.map((leaf) => ({
              item: leaf,
              parent: item,
              groupId: group.id,
            })),
      ),
    ),
    ...tree.footer.map((item) => ({ item, groupId: "footer" })),
  ];
}

export function findActiveItem(
  tree: NavTree,
  pathname: string,
): ActiveNavItem | undefined {
  let active: ActiveNavItem | undefined;
  for (const entry of navLeaves(tree)) {
    const { item } = entry;
    if (
      (pathname === item.path ||
        (item.path !== "/" && pathname.startsWith(`${item.path}/`))) &&
      (!active || item.path.length > active.item.path.length)
    ) {
      active = entry;
    }
  }
  return active;
}
