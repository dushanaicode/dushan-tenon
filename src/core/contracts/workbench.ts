import type { Id } from "@/lib/generated/Id";
import type { WorkbenchChange } from "@/lib/generated/WorkbenchChange";
import type { WorkbenchLayout } from "@/lib/generated/WorkbenchLayout";

/** Frontend object references; the host's current workbench contract stores layout only. */
export type ObjectRef = { kind: "job"; id: Id };
export type ObjectState = {
  objects: ObjectRef[];
  activeObject: ObjectRef | null;
};
export type WorkbenchAction =
  | WorkbenchChange
  | { kind: "set-auxiliary"; patch: Partial<WorkbenchLayout["auxiliary"]> }
  | ({ kind: "set-objects" } & ObjectState)
  | { kind: "reset-layout" };
