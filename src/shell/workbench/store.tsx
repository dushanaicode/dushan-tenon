import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ObjectState } from "@/core/contracts/workbench";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button } from "@/kit";
import type { AuxiliaryLayout } from "@/lib/generated/AuxiliaryLayout";
import {
  appWorkbenchGet,
  appWorkbenchResetLayout,
  appWorkbenchUpdate,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { WorkbenchChange } from "@/lib/generated/WorkbenchChange";
import type { WorkbenchLayoutChange } from "@/lib/generated/WorkbenchLayoutChange";
import type { WorkbenchSnapshot } from "@/lib/generated/WorkbenchSnapshot";

type WorkbenchAction =
  | Exclude<WorkbenchChange, { kind: "set-auxiliary" }>
  | { kind: "set-auxiliary"; patch: Partial<AuxiliaryLayout> }
  | { kind: "reset-layout" };

type WorkbenchContext = {
  snapshot: WorkbenchSnapshot;
  pending: boolean;
  error: IpcError | null;
  reload: () => void;
  retry: () => Promise<boolean>;
  updateLayout: (layout: WorkbenchLayoutChange) => Promise<boolean>;
  updateAuxiliary: (patch: Partial<AuxiliaryLayout>) => Promise<boolean>;
  updateObjects: (state: ObjectState) => Promise<boolean>;
  resetLayout: () => Promise<boolean>;
};
const Workbench = createContext<WorkbenchContext | null>(null);

export function WorkbenchProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  return (
    <WorkbenchScope key={userId} userId={userId}>
      {children}
    </WorkbenchScope>
  );
}

function WorkbenchScope({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ["workbench", userId, "default"];
  const active = useRef(true);
  const [failed, setFailed] = useState<WorkbenchAction | null>(null);
  const query = useQuery<WorkbenchSnapshot, IpcError>({
    queryKey: key,
    queryFn: appWorkbenchGet,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const mutation = useMutation<WorkbenchSnapshot, IpcError, WorkbenchAction>({
    scope: { id: `workbench:${userId}:default` },
    mutationFn: async (action) => {
      // Read the confirmed revision when this serialized operation starts, not when queued.
      const current = client.getQueryData<WorkbenchSnapshot>(key);
      if (!active.current || !current)
        throw new Error("Workbench scope is no longer active");
      if (action.kind === "reset-layout")
        return appWorkbenchResetLayout({ expectedRevision: current.revision });
      return appWorkbenchUpdate({
        expectedRevision: current.revision,
        change:
          action.kind === "set-auxiliary"
            ? {
                kind: "set-auxiliary",
                auxiliary: { ...current.auxiliary, ...action.patch },
              }
            : action,
      });
    },
    onSuccess: (snapshot) => {
      if (active.current) {
        client.setQueryData(key, snapshot);
        setFailed(null);
      }
    },
    onError: (_error, action) => {
      if (active.current) setFailed(action);
    },
  });
  async function commit(action: WorkbenchAction) {
    try {
      await mutation.mutateAsync(action);
      return true;
    } catch {
      // The mutation retains the IPC error and last confirmed snapshot for explicit recovery.
      return false;
    }
  }
  function reload() {
    setFailed(null);
    mutation.reset();
    void query.refetch();
  }
  if (query.isPending)
    return <p role="status">{t("settings.workbench.loading")}</p>;
  if (query.isError)
    return (
      <div>
        <IpcErrorMessage error={query.error} />
        <Button onClick={reload}>{t("settings.workbench.reload")}</Button>
      </div>
    );
  return (
    <Workbench.Provider
      value={{
        snapshot: query.data,
        pending: mutation.isPending || query.isFetching,
        error: mutation.error,
        reload,
        retry: () => (failed ? commit(failed) : Promise.resolve(true)),
        updateLayout: (layout) => commit({ kind: "set-layout", layout }),
        updateAuxiliary: (patch) => commit({ kind: "set-auxiliary", patch }),
        updateObjects: (state) => commit({ kind: "set-objects", ...state }),
        resetLayout: () => commit({ kind: "reset-layout" }),
      }}
    >
      {children}
    </Workbench.Provider>
  );
}

export function useWorkbench() {
  const value = useContext(Workbench);
  if (!value) throw new Error("WorkbenchProvider is required");
  return value;
}

export function WorkbenchFeedback() {
  const workbench = useWorkbench();
  const { t } = useTranslation();
  if (!workbench.error) return null;
  return (
    <div className="space-y-2 pb-4">
      <IpcErrorMessage error={workbench.error} />
      <Button
        variant="outline"
        disabled={workbench.pending}
        onClick={workbench.reload}
      >
        {t("settings.workbench.reload")}
      </Button>
      {workbench.error.code !== "app.workbench.conflict" && (
        <Button
          variant="outline"
          disabled={workbench.pending}
          onClick={() => {
            void workbench.retry();
          }}
        >
          {t("settings.workbench.retry")}
        </Button>
      )}
    </div>
  );
}
