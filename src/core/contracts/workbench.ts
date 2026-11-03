import type { AuxiliaryLayout } from "@/lib/generated/AuxiliaryLayout";
import type { Id } from "@/lib/generated/Id";
import type { WorkbenchChange } from "@/lib/generated/WorkbenchChange";

/** Frontend object references; the host's current workbench contract stores layout only. */
export type ObjectRef = { kind: "job"; id: Id };
export type ObjectState = {
  objects: ObjectRef[];
  activeObject: ObjectRef | null;
};
export type WorkbenchAction =
  | WorkbenchChange
  | { kind: "set-auxiliary"; patch: Partial<AuxiliaryLayout> }
  | ({ kind: "set-objects" } & ObjectState)
  | { kind: "reset-layout" };
