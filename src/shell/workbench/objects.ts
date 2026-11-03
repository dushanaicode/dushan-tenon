import { matchPath } from "react-router";
import type {
  ModuleManifest,
  WorkbenchObjectContribution,
} from "@/core/contracts/module";
import type { ObjectRef, ObjectState } from "@/core/contracts/workbench";
import { routeOfPath } from "@/core/module-directory";
import { evaluateVisibility, type VisibilityAuth } from "@/core/visibility";
import { isId } from "@/lib/id";

export { MAX_OBJECTS } from "@/lib/generated/workbench";

export function objectKey(ref: ObjectRef) {
  return `${ref.kind}:${ref.id}`;
}

export function objectRoute(
  contribution: WorkbenchObjectContribution,
  ref: ObjectRef,
) {
  return contribution.route.replace(":id", ref.id);
}

export function objectContributions(manifests: readonly ModuleManifest[]) {
  const contributions = manifests.flatMap((manifest) =>
    manifest.workbenchObjects.map((contribution) => ({
      manifest,
      contribution,
    })),
  );
  const kinds = new Set<string>();
  for (const { manifest, contribution } of contributions) {
    if (kinds.has(contribution.kind))
      throw new Error(`Duplicate workbench object kind: ${contribution.kind}`);
    if (!routeOfPath(manifest, contribution.route))
      throw new Error(`Missing workbench object route: ${contribution.route}`);
    kinds.add(contribution.kind);
  }
  return contributions;
}

export function objectFromPath(
  contributions: ReturnType<typeof objectContributions>,
  path: string,
): ObjectRef | null {
  for (const { contribution } of contributions) {
    const id = matchPath(
      { path: contribution.route, caseSensitive: true, end: true },
      path,
    )?.params.id;
    if (id && isId(id)) return { kind: contribution.kind, id };
  }
  return null;
}

export function accessibleContribution(
  contributions: ReturnType<typeof objectContributions>,
  ref: ObjectRef,
  enabled: ReadonlySet<string>,
  auth: VisibilityAuth,
) {
  const entry = contributions.find(
    ({ contribution }) => contribution.kind === ref.kind,
  );
  if (!entry || !enabled.has(entry.manifest.id)) return undefined;
  const route = routeOfPath(
    entry.manifest,
    objectRoute(entry.contribution, ref),
  );
  return route && evaluateVisibility(route, auth) === "visible"
    ? entry.contribution
    : undefined;
}

export function openObject(state: ObjectState, ref: ObjectRef): ObjectState {
  const exists = state.objects.some(
    (item) => objectKey(item) === objectKey(ref),
  );
  return {
    objects: exists ? state.objects : [...state.objects, ref],
    activeObject: ref,
  };
}

export function closeObject(state: ObjectState, ref: ObjectRef): ObjectState {
  const index = state.objects.findIndex(
    (item) => objectKey(item) === objectKey(ref),
  );
  const objects = state.objects.filter(
    (item) => objectKey(item) !== objectKey(ref),
  );
  const activeObject =
    state.activeObject && objectKey(state.activeObject) === objectKey(ref)
      ? (objects[index] ?? objects[index - 1] ?? null)
      : state.activeObject;
  return { objects, activeObject };
}

export function retainObjects(
  state: ObjectState,
  keys: ReadonlySet<string>,
): ObjectState {
  return state.objects.reduce(
    (current, ref) =>
      keys.has(objectKey(ref)) ? current : closeObject(current, ref),
    state,
  );
}

export function sameObjects(a: ObjectState, b: ObjectState) {
  return (
    a.objects.length === b.objects.length &&
    a.objects.every(
      (ref, index) => objectKey(ref) === objectKey(b.objects[index]),
    ) &&
    (a.activeObject ? objectKey(a.activeObject) : null) ===
      (b.activeObject ? objectKey(b.activeObject) : null)
  );
}
