import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";
import { authKey, useAuthStatus } from "@/core/auth";
import { useIpcErrorToast } from "@/core/use-ipc-toast";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/kit";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import {
  appWindowEditDecide,
  appWindowEditState,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import { IpcErrorMessage } from "./ipc-error";
import { onWindowEvent } from "./window-events";

export type EditSession = {
  label: string;
  dirty: boolean;
  canSave: boolean;
  pending: boolean;
  blocksNavigation?: (nextPath: string) => boolean;
  save: () => Promise<void>;
  discard: () => Promise<void>;
  flush: () => Promise<void>;
};
type Registration = { current: EditSession; scope: string };
const EditSessions = createContext<{
  scope: string;
  register: (id: string, entry: Registration) => () => void;
  changed: () => void;
} | null>(null);
// Keep publication ordered when authentication replaces the provider instance.
let editStateQueue: Promise<void> = Promise.resolve();

/** One route blocker and one main-window edit signal, regardless of how many editors are open. */
export function EditSessionsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const auth = useAuthStatus();
  const client = useQueryClient();
  const scope = `${auth.data?.state}:${auth.data?.user?.id}:${auth.data?.permissions.join(",")}`;
  const scopeRef = useRef(scope);
  const entries = useRef(new Map<string, Registration>());
  const lastPublished = useRef({ dirty: false, pending: false });
  const [, setRevision] = useState(0);
  const [nativeRequest, setNativeRequest] = useState<string | null>(null);
  const nativeRef = useRef<string | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<IpcError | null>(null);
  const reportError = useIpcErrorToast();
  const report = useEffectEvent(reportError);
  const teardownReport = useRef(reportError);
  teardownReport.current = reportError;
  const changed = useCallback(() => setRevision((value) => value + 1), []);
  const register = useCallback(
    (id: string, entry: Registration) => {
      entries.current.set(id, entry);
      changed();
      return () => {
        if (entries.current.get(id) === entry) {
          entries.current.delete(id);
          changed();
        }
      };
    },
    [changed],
  );
  const active = () =>
    [...entries.current.entries()].filter(
      ([, entry]) =>
        auth.data?.state === "active" &&
        auth.data.user !== null &&
        entry.scope === scope &&
        (entry.current.dirty || entry.current.pending),
    );
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname &&
      active().some(
        ([, entry]) =>
          entry.current.blocksNavigation?.(nextLocation.pathname) !== false,
      ),
  );
  const hasActiveEdits = useEffectEvent(() => active().length > 0);
  const publish = useCallback((state: { dirty: boolean; pending: boolean }) => {
    const next = editStateQueue
      .then(() => appWindowEditState(state))
      .then(() => {});
    editStateQueue = next.catch(() => {
      /* The caller surfaces the failed state publication. */
    });
    return next;
  }, []);
  useEffect(() => {
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      for (const [id, entry] of entries.current)
        if (entry.scope !== scope) entries.current.delete(id);
      if (nativeRef.current !== null)
        void appWindowEditDecide({
          requestId: nativeRef.current,
          proceed: false,
        }).catch((failure: IpcError) => teardownReport.current(failure));
      nativeRef.current = null;
      setNativeRequest(null);
      setError(null);
      if (blocker.state === "blocked") blocker.reset();
      changed();
    }
  }, [blocker, changed, scope]);
  useLayoutEffect(() => {
    mounted.current = true;
    const unsubscribe = onWindowEvent("tenon:edit-close", (event) => {
      event.preventDefault();
      nativeRef.current = event.detail.requestId;
      setNativeRequest(nativeRef.current);
      setError(null);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      const requestId = nativeRef.current;
      nativeRef.current = null;
      if (requestId !== null)
        void appWindowEditDecide({
          requestId,
          proceed: false,
        }).catch((failure: IpcError) => teardownReport.current(failure));
      const current = client.getQueryData<AuthStatus>(authKey);
      const verifiedScope = current
        ? `${current.state}:${current.user?.id}:${current.permissions.join(",")}`
        : null;
      // Error-boundary unmount must not claim that unsaved edits disappeared.
      // A verified lock/logout/identity change intentionally clears the old scope.
      if (
        current &&
        (current.state !== "active" ||
          current.user === null ||
          verifiedScope !== scopeRef.current ||
          (!lastPublished.current.dirty && !lastPublished.current.pending))
      ) {
        void publish({ dirty: false, pending: false }).catch(
          (failure: IpcError) => teardownReport.current(failure),
        );
      }
    };
  }, [client, publish]);
  const sessions = active();
  const dirty = sessions.some(([, entry]) => entry.current.dirty);
  const saving = sessions.some(([, entry]) => entry.current.pending);
  useLayoutEffect(() => {
    if (busy || busyRef.current) return;
    const state = {
      dirty,
      pending: saving,
    };
    lastPublished.current = state;
    void publish(state).catch((failure) => {
      setError(failure as IpcError);
      report(failure as IpcError);
    });
  }, [publish, dirty, saving, busy]);
  const selected = sessions.filter(
    ([, entry]) =>
      nativeRequest !== null ||
      (blocker.state === "blocked" &&
        entry.current.blocksNavigation?.(blocker.location.pathname) !== false),
  );
  const settingsOnly = selected.length === 1 && selected[0][0] === "settings";
  const pending = busy || selected.some(([, entry]) => entry.current.pending);
  const canSave =
    selected.length > 0 && selected.every(([, entry]) => entry.current.canSave);
  useEffect(() => {
    if (
      nativeRequest === null ||
      nativeRef.current !== nativeRequest ||
      selected.length > 0 ||
      busyRef.current
    )
      return;
    busyRef.current = true;
    setBusy(true);
    const originalScope = scopeRef.current;
    void publish({ dirty: false, pending: false })
      .then(async () => {
        if (
          scopeRef.current !== originalScope ||
          nativeRef.current !== nativeRequest ||
          hasActiveEdits()
        )
          return false;
        await appWindowEditDecide({ requestId: nativeRequest, proceed: true });
        return true;
      })
      .then((approved) => {
        if (
          !approved ||
          scopeRef.current !== originalScope ||
          nativeRef.current !== nativeRequest
        )
          return;
        nativeRef.current = null;
        setNativeRequest(null);
      })
      .catch((failure) => setError(failure as IpcError))
      .finally(() => {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      });
  }, [nativeRequest, publish, selected.length]);
  async function cancel() {
    if (busyRef.current) return;
    if (nativeRequest !== null) {
      await appWindowEditDecide({ requestId: nativeRequest, proceed: false });
      nativeRef.current = null;
      setNativeRequest(null);
    }
    if (blocker.state === "blocked") blocker.reset();
    setError(null);
  }
  async function resolve(action: "save" | "discard") {
    if (pending || busyRef.current || (action === "save" && !canSave)) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const originalScope = scopeRef.current;
    try {
      for (const [, entry] of selected) {
        await entry.current[action]();
        if (!mounted.current || scopeRef.current !== originalScope) return;
      }
      if (nativeRequest !== null) {
        // Await the final clean signal after all earlier publications; no same-frame race.
        await publish({ dirty: false, pending: false });
        if (
          scopeRef.current !== originalScope ||
          nativeRef.current !== nativeRequest
        )
          return;
        await appWindowEditDecide({ requestId: nativeRequest, proceed: true });
        if (
          scopeRef.current !== originalScope ||
          nativeRef.current !== nativeRequest
        )
          return;
        nativeRef.current = null;
        setNativeRequest(null);
      }
      if (blocker.state === "blocked") blocker.proceed();
    } catch (failure) {
      setError(failure as IpcError);
    } finally {
      busyRef.current = false;
      setBusy(false);
      changed();
    }
  }
  return (
    <EditSessions.Provider value={{ scope, register, changed }}>
      {children}
      <Dialog
        open={nativeRequest !== null || blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && !pending)
            void cancel().catch((failure) => setError(failure as IpcError));
        }}
      >
        <DialogContent role="alertdialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t(settingsOnly ? "settings.leaveTitle" : "edit.leaveTitle")}
            </DialogTitle>
            <DialogDescription>
              {t(
                settingsOnly
                  ? "settings.leaveConfirm"
                  : "edit.leaveDescription",
              )}
            </DialogDescription>
          </DialogHeader>
          {!settingsOnly && (
            <ul className="space-y-1 text-sm">
              {selected.map(([id, entry]) => (
                <li key={id}>{entry.current.label}</li>
              ))}
            </ul>
          )}
          {error && <IpcErrorMessage error={error} />}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                void cancel().catch((failure) => setError(failure as IpcError))
              }
            >
              {t("settings.continueEditing")}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void resolve("discard")}
            >
              {t("settings.discardAll")}
            </Button>
            {canSave && (
              <Button disabled={pending} onClick={() => void resolve("save")}>
                {t("edit.saveLeave")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EditSessions.Provider>
  );
}

export function useEditSession(id: string, session: EditSession) {
  const context = useContext(EditSessions);
  if (!context) throw new Error("EditSessionsProvider is required");
  const { scope, register, changed } = context;
  const entry = useRef<Registration>({ current: session, scope });
  if (entry.current.scope !== scope)
    entry.current = { current: session, scope };
  entry.current.current = session;
  const registration = entry.current;
  useLayoutEffect(
    () => register(id, registration),
    [id, register, registration],
  );
  const previous = useRef({
    dirty: session.dirty,
    pending: session.pending,
    canSave: session.canSave,
  });
  useLayoutEffect(() => {
    if (
      previous.current.dirty === session.dirty &&
      previous.current.pending === session.pending &&
      previous.current.canSave === session.canSave
    )
      return;
    previous.current = {
      dirty: session.dirty,
      pending: session.pending,
      canSave: session.canSave,
    };
    changed();
  }, [changed, session.dirty, session.pending, session.canSave]);
}
