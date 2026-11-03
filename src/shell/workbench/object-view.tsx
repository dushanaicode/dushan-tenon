import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import type {
  ObjectViewProps,
  ResolvedObject,
  WorkbenchObjectContribution,
} from "@/core/contracts/module";
import type { ObjectRef, ObjectState } from "@/core/contracts/workbench";
import { IpcErrorMessage } from "@/core/ipc-error";
import { LazyContent, LoadingContent } from "@/core/lazy-content";
import { Button } from "@/kit";
import type { IpcError } from "@/lib/generated/IpcError";
import { useShellEnvironment } from "../shell-context";
import {
  accessibleContribution,
  closeObject,
  MAX_OBJECTS,
  objectContributions,
  objectFromPath,
  objectKey,
  objectRoute,
  openObject,
  retainObjects,
  sameObjects,
} from "./objects";
import { useWorkbench } from "./store";

type Entry = {
  object: ResolvedObject;
  contribution: WorkbenchObjectContribution;
};
type ObjectContext = {
  entries: Entry[];
  current: Entry | undefined;
  pending: boolean;
  error: IpcError | null;
  removed: number;
  limit: boolean;
  objectPath: boolean;
  activate: (ref: ObjectRef) => Promise<void>;
  close: (ref: ObjectRef) => void;
  closeAll: () => void;
  unavailable: (ref: ObjectRef) => void;
  retry: () => void;
};
const Objects = createContext<ObjectContext | null>(null);

export function WorkbenchObjectsProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const workbench = useWorkbench();
  const client = useQueryClient();
  const { manifests, enabled, auth } = useShellEnvironment();
  const contributions = useMemo(
    () => objectContributions(manifests),
    [manifests],
  );
  const location = useLocation();
  const navigate = useNavigate();
  // A router transition can arrive after a failed save was retried.
  // Consume our replacements without treating them as a new object open.
  const pendingReplace = useRef<string | null>(null);
  const replaceRoute = useCallback(
    (path: string) => {
      pendingReplace.current = path;
      void navigate(path, { replace: true });
    },
    [navigate],
  );
  const { i18n } = useTranslation();
  const [optimistic, setOptimistic] = useState<ObjectState | null>(null);
  const [activating, setActivating] = useState(false);
  const [actionError, setActionError] = useState<IpcError | null>(null);
  const [removed, setRemoved] = useState(0);
  const initialized = useRef(false);
  const [handledLocation, setHandledLocation] = useState<string | null>(null);
  const mounted = useRef(true);
  const scope = JSON.stringify([
    userId,
    auth,
    [...enabled],
    i18n.resolvedLanguage,
  ]);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ready = auth.authenticated;
  const allowed = (ref: ObjectRef) =>
    ready
      ? accessibleContribution(contributions, ref, enabled, auth)
      : undefined;
  const saved = workbench.snapshot;
  const state = optimistic ?? saved;
  const pathRef = objectFromPath(contributions, location.pathname);
  const locationToken = location.key;
  const unhandled =
    handledLocation !== locationToken &&
    pendingReplace.current !== location.pathname;
  const limit = Boolean(
    pathRef &&
      state.objects.length === MAX_OBJECTS &&
      !state.objects.some((ref) => objectKey(ref) === objectKey(pathRef)),
  );
  const requested =
    unhandled && pathRef && !limit ? openObject(state, pathRef) : state;
  const candidates = requested.objects.flatMap((ref) => {
    const contribution = allowed(ref);
    return contribution ? [{ ref, contribution }] : [];
  });
  const queryKey = (ref: ObjectRef) => [
    "workbench-objects",
    scope,
    objectKey(ref),
  ];
  const queries = useQueries({
    queries: candidates.map(({ ref, contribution }) => ({
      queryKey: queryKey(ref),
      queryFn: () => contribution.resolve(ref),
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    })),
  });
  const entries = candidates.flatMap(({ contribution }, index) => {
    const result = queries[index];
    return result.isSuccess && result.data
      ? [{ object: result.data, contribution }]
      : [];
  });
  const retained = retainObjects(
    requested,
    new Set(entries.map(({ object }) => objectKey(object.ref))),
  );
  const resolving = !ready || queries.some((query) => query.isPending);
  const error =
    actionError ??
    (queries.find((query) => query.isError)?.error as IpcError | undefined) ??
    null;
  const pending =
    resolving ||
    activating ||
    optimistic !== null ||
    workbench.pending ||
    workbench.error !== null ||
    (unhandled && pathRef !== null && !limit) ||
    (!workbench.error && !sameObjects(saved, retained));

  useEffect(() => {
    if (pendingReplace.current === location.pathname) {
      pendingReplace.current = null;
      setHandledLocation(locationToken);
    }
    if (workbench.error) {
      setOptimistic(null);
      setHandledLocation(locationToken);
      return;
    }
    if (optimistic) {
      // Mutation completion can precede the render of its confirmed snapshot.
      if (sameObjects(saved, optimistic)) setOptimistic(null);
      return;
    }
    if (resolving || error || workbench.pending) return;
    const first = !initialized.current;
    initialized.current = true;
    if (!limit) setHandledLocation(locationToken);
    const missing = requested.objects.length - retained.objects.length;
    if (missing > 0) setRemoved(missing);
    const active = retained.activeObject;
    const activeContribution = active
      ? contributions.find(
          ({ contribution }) => contribution.kind === active.kind,
        )?.contribution
      : undefined;
    if (
      (first && location.pathname === "/" && active && activeContribution) ||
      (pathRef &&
        !limit &&
        !retained.objects.some((ref) => objectKey(ref) === objectKey(pathRef)))
    ) {
      replaceRoute(
        active && activeContribution
          ? objectRoute(activeContribution, active)
          : "/",
      );
    }
    if (!sameObjects(saved, retained)) {
      setOptimistic(retained);
      void workbench.updateObjects(retained);
    }
  }, [
    contributions,
    resolving,
    error,
    optimistic,
    workbench,
    locationToken,
    location.pathname,
    pathRef,
    limit,
    requested,
    retained,
    saved,
    replaceRoute,
  ]);

  function destination(next: ObjectState) {
    const entry = next.activeObject
      ? contributions.find(
          ({ contribution }) => contribution.kind === next.activeObject?.kind,
        )
      : undefined;
    return next.activeObject && entry
      ? objectRoute(entry.contribution, next.activeObject)
      : "/";
  }
  function commit(next: ObjectState, replace: boolean) {
    setHandledLocation(locationToken);
    setOptimistic(next);
    if (replace) replaceRoute(destination(next));
    void workbench.updateObjects(next).then((success) => {
      if (!mounted.current) return;
      if (!success && replace) replaceRoute(destination(saved));
    });
  }
  function close(ref: ObjectRef) {
    if (pending) return;
    const next = closeObject(state, ref);
    commit(next, Boolean(pathRef && objectKey(pathRef) === objectKey(ref)));
  }
  async function activate(ref: ObjectRef) {
    const contribution = allowed(ref);
    if (!contribution || pending) return;
    setActivating(true);
    setActionError(null);
    try {
      const object = await client.fetchQuery({
        queryKey: queryKey(ref),
        queryFn: () => contribution.resolve(ref),
        staleTime: 0,
      });
      if (!mounted.current || liveScope.current !== scope) return;
      if (!object) {
        setRemoved(1);
        commit(
          closeObject(state, ref),
          Boolean(pathRef && objectKey(pathRef) === objectKey(ref)),
        );
        return;
      }
      void navigate(objectRoute(contribution, ref));
    } catch (failure) {
      if (mounted.current && liveScope.current === scope)
        setActionError(failure as IpcError);
    } finally {
      if (mounted.current) setActivating(false);
    }
  }
  const current = pathRef
    ? entries.find(({ object }) => objectKey(object.ref) === objectKey(pathRef))
    : undefined;
  return (
    <Objects.Provider
      value={{
        entries,
        current,
        pending,
        error,
        removed,
        limit,
        objectPath: pathRef !== null,
        activate,
        close,
        unavailable: (ref) => {
          client.setQueryData(queryKey(ref), null);
        },
        closeAll: () => {
          if (!pending)
            commit({ objects: [], activeObject: null }, current !== undefined);
        },
        retry: () => {
          setActionError(null);
          void client.invalidateQueries({
            queryKey: ["workbench-objects", scope],
          });
        },
      }}
    >
      {children}
    </Objects.Provider>
  );
}

export function useWorkbenchObjects() {
  const context = useContext(Objects);
  if (!context) throw new Error("WorkbenchObjectsProvider is required");
  return context;
}

function CurrentObject({
  Component,
}: {
  Component: ComponentType<ObjectViewProps>;
}) {
  const { current, unavailable } = useWorkbenchObjects();
  return current ? (
    <Component
      object={current.object}
      onUnavailable={() => unavailable(current.object.ref)}
    />
  ) : null;
}

function ResolvedView({ entry }: { entry: Entry }) {
  const factory = useMemo(
    () => async () => {
      const { default: Component } = await entry.contribution.Component();
      return {
        default: () => <CurrentObject Component={Component} />,
      };
    },
    [entry.contribution],
  );
  return <LazyContent factory={factory} />;
}

export function ObjectView({ children }: { children: ReactNode }) {
  const objects = useWorkbenchObjects();
  const { t } = useTranslation();
  const failure = objects.error ? (
    <div>
      <IpcErrorMessage error={objects.error} />
      <Button onClick={objects.retry}>{t("settings.retry")}</Button>
    </div>
  ) : null;
  if (!objects.objectPath)
    return (
      <>
        {failure}
        {children}
      </>
    );
  if (objects.limit)
    return (
      <p role="alert">{t("workbench.objects.limit", { count: MAX_OBJECTS })}</p>
    );
  if (failure) return failure;
  if (!objects.current) return <LoadingContent />;
  return (
    <div
      id="workbench-object-view"
      role="tabpanel"
      aria-labelledby={`object-tab-${objectKey(objects.current.object.ref)}`}
    >
      <ResolvedView
        key={objectKey(objects.current.object.ref)}
        entry={objects.current}
      />
    </div>
  );
}
