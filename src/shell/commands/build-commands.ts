import type { CommandContext, ModuleManifest } from "@/core/contracts/module";
import type { SettingSection } from "@/core/contracts/settings";
import { ICONS } from "@/kit";
import type { NavLeaf, NavTree } from "../nav-tree";
import type { ShellCommand } from "./types";

export function buildCommands({
  tree,
  sections,
  manifests,
  builtin,
  t,
  permissions,
  navigate,
}: {
  tree: NavTree;
  sections: readonly SettingSection[];
  manifests: readonly ModuleManifest[];
  builtin: readonly ShellCommand[];
  t: (key: string) => string;
  permissions: readonly string[];
  navigate: CommandContext["navigate"];
}): ShellCommand[] {
  const navigation = (item: NavLeaf, keywords: string[]): ShellCommand => ({
    id: `nav:${item.id}`,
    label: t(item.label),
    group: "pages",
    keywords,
    shortcut: item.shortcut,
    Icon: ICONS[item.iconId],
    run: () => navigate(item.path),
  });
  const commands = [
    ...tree.groups.flatMap((group) =>
      group.items.flatMap((item) => {
        const keywords = group.label ? [t(group.label)] : [];
        if (item.kind === "leaf") return [navigation(item, keywords)];
        let section: string | undefined;
        return item.children.map((leaf) => {
          if (leaf.sectionLabel) section = leaf.sectionLabel;
          return navigation(leaf, [
            ...keywords,
            t(item.label),
            ...(section ? [t(section)] : []),
          ]);
        });
      }),
    ),
    ...tree.footer.map((item) => navigation(item, [])),
    ...sections.map(
      (section): ShellCommand => ({
        id: `nav:${section.path}`,
        label: t(section.labelKey),
        group: "pages",
        keywords: [t("nav.settings")],
        run: () => navigate(section.path),
      }),
    ),
  ];
  for (const manifest of manifests) {
    for (const command of manifest.commands ?? []) {
      if (command.permission && !permissions.includes(command.permission))
        continue;
      commands.push({
        id: command.id,
        label: t(command.label),
        group: "actions",
        keywords: (command.keywords ?? []).map((key) => t(key)),
        shortcut: command.shortcut,
        run: () => command.run({ navigate }),
      });
    }
  }
  commands.push(...builtin);
  validateCommands(commands);
  return commands;
}

export function validateCommands(commands: readonly ShellCommand[]) {
  const ids = new Set<string>();
  const shortcuts = new Set<string>();
  for (const command of commands) {
    const id = command.id.toLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate command id: ${command.id}`);
    ids.add(id);
    if (command.shortcut) {
      const shortcut = command.shortcut.toLowerCase();
      if (shortcuts.has(shortcut))
        throw new Error(`Duplicate shortcut: ${command.shortcut}`);
      shortcuts.add(shortcut);
    }
  }
}
