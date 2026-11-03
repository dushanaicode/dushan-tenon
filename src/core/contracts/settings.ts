import type { IpcError } from "@/lib/generated/IpcError";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import type { LazyComponent, ModuleId, Visibility } from "./module";

type SectionBase = {
  id: string;
  path: `/settings/${string}`;
  labelKey: string;
  order: number;
  moduleId: ModuleId | null;
  visibility: Visibility;
};

export type SettingSection = SectionBase &
  (
    | { kind: "component"; Component: LazyComponent }
    | { kind: "params"; group: string; entries: readonly ParamEntry[] }
  );
export type VisibilityResult = "visible" | "notFound" | "forbidden";
export type SectionTable = {
  all: readonly SettingSection[];
  visible: readonly SettingSection[];
  access: ReadonlyMap<string, VisibilityResult>;
};
export type SectionDirectory =
  | { status: "pending" }
  | { status: "error"; error: IpcError }
  | { status: "success"; table: SectionTable };
