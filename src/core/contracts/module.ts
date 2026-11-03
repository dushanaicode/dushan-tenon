import type { ComponentType } from "react";
import type { IconId } from "@/kit";
import type { AuthMode } from "@/lib/generated/AuthMode";
import type { MODULE_IDS, PermissionKey } from "@/lib/generated/permissions";
import type { NavBadge } from "./navigation";
import type { ObjectRef } from "./workbench";

export type ModuleId = (typeof MODULE_IDS)[number];
export type LazyComponent = () => Promise<{ default: ComponentType }>;
export type Visibility = {
  developerOnly?: true;
  permission?: PermissionKey;
  anyPermissions?: readonly PermissionKey[];
  authMode?: AuthMode;
};

export type ModuleNavLeaf = {
  kind: "leaf";
  id: string;
  path: string;
  label: string;
  iconId: IconId;
  permission?: PermissionKey;
  badge?: NavBadge;
  shortcut?: string;
  children?: never;
};
export type ModuleNavParent = {
  kind: "parent";
  id: string;
  label: string;
  iconId: IconId;
  badge?: NavBadge;
  path?: never;
  children: readonly [ModuleNavLeaf, ...ModuleNavLeaf[]];
};
export type ModuleNavItem = ModuleNavLeaf | ModuleNavParent;

export type ModuleRoute = Visibility & {
  path: string;
  Component: LazyComponent;
};

export type ModuleDevPage = ModuleRoute & {
  nav?: {
    id: string;
    labelKey: string;
    order: number;
    iconId: IconId;
    parentId?: string;
    sectionLabelKey?: string;
  };
};

export type ModuleSetting = Visibility & {
  id: string;
  labelKey: string;
  order: number;
  Component: LazyComponent;
  paramGroups?: readonly string[];
};

export type ModuleHeaderWidget = Visibility & {
  id: string;
  order: number;
  Component: LazyComponent;
};

export type CommandContext = { navigate: (path: string) => void };

export type ModuleCommand = {
  id: string;
  label: string;
  keywords?: readonly string[];
  permission?: PermissionKey;
  shortcut?: string;
  run: (context: CommandContext) => void | Promise<void>;
};

export type ResolvedObject = {
  ref: ObjectRef;
  title: string;
  iconId: IconId;
};
export type ObjectViewProps = {
  object: ResolvedObject;
  onUnavailable: () => void;
};
export type WorkbenchObjectContribution = {
  kind: ObjectRef["kind"];
  route: string;
  resolve: (ref: ObjectRef) => Promise<ResolvedObject | null>;
  Component: () => Promise<{ default: ComponentType<ObjectViewProps> }>;
};

export type WorkbenchPanelContribution = Visibility & {
  id: string;
  order: number;
  labelKey: string;
  iconId: IconId;
  objectKind: ObjectRef["kind"];
  Component: () => Promise<{ default: ComponentType<ObjectViewProps> }>;
};

export type ModuleManifest = {
  id: ModuleId;
  basePath: string;
  nav: ModuleNavItem[];
  devNavParents?: readonly {
    id: string;
    labelKey: string;
    iconId: IconId;
    order: number;
  }[];
  routes: ModuleRoute[];
  devPages: ModuleDevPage[];
  settings: ModuleSetting[];
  headerWidgets: ModuleHeaderWidget[];
  workbenchObjects: WorkbenchObjectContribution[];
  workbenchPanels: WorkbenchPanelContribution[];
  commands?: ModuleCommand[];
};
