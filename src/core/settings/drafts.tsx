import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { useAuthStatus } from "@/core/auth";
import { useEditSession } from "@/core/edit-sessions";
import type { IpcError } from "@/lib/generated/IpcError";
import type { ParamEntry } from "@/lib/generated/ParamEntry";

export type ParamDraft = {
  value: string;
  baseVersion: number | null;
  sectionPath?: string;
};
type DraftStatus = { sectionPath: string; valid: boolean; pending: boolean };
type DraftActions = {
  save: () => Promise<IpcError | null | false>;
  discard: () => void;
};
type DraftContext = {
  drafts: ReadonlyMap<string, ParamDraft>;
  items: ReadonlyMap<string, DraftStatus>;
  errors: ReadonlyMap<string, IpcError>;
  failed: ReadonlySet<string>;
  applying: boolean;
  set: (key: string, draft: ParamDraft | null) => void;
  register: (
    key: string,
    status: DraftStatus | null,
    actions: DraftActions,
  ) => void;
  unregister: (key: string) => void;
  apply: () => Promise<void>;
  discardAll: () => void;
};
const Drafts = createContext<DraftContext | null>(null);

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const auth = useAuthStatus();
  const { t } = useTranslation();
  const scope = [
    auth.data?.state,
    auth.data?.user?.id,
    auth.data?.permissions.join(","),
  ].join(":");
  const actions = useRef(new Map<string, DraftActions>());
  const currentScope = useRef(scope);
  const applying = useRef(false);
  const [store, setStore] = useState({
    scope,
    drafts: new Map<string, ParamDraft>(),
    items: new Map<string, DraftStatus>(),
    errors: new Map<string, IpcError>(),
    failed: new Set<string>(),
    applying: false,
  });
  if (store.scope !== scope) {
    currentScope.current = scope;
    actions.current.clear();
    applying.current = false;
    setStore({
      scope,
      drafts: new Map(),
      items: new Map(),
      errors: new Map(),
      failed: new Set(),
      applying: false,
    });
  }
  const unregister = useCallback(
    (key: string) => {
      if (currentScope.current !== scope) return;
      actions.current.delete(key);
      setStore((current) => {
        if (current.scope !== scope || !current.items.has(key)) return current;
        const items = new Map(current.items);
        items.delete(key);
        const errors = new Map(current.errors);
        errors.delete(key);
        const failed = new Set(current.failed);
        failed.delete(key);
        return { ...current, items, errors, failed };
      });
    },
    [scope],
  );
  const set = useCallback(
    (key: string, draft: ParamDraft | null) => {
      setStore((current) => {
        if (current.scope !== scope) return current;
        const drafts = new Map(current.drafts);
        if (draft) drafts.set(key, draft);
        else drafts.delete(key);
        return { ...current, drafts };
      });
      if (!draft) unregister(key);
    },
    [scope, unregister],
  );
  const register = useCallback(
    (key: string, status: DraftStatus | null, operation: DraftActions) => {
      if (currentScope.current !== scope) return;
      if (!status) {
        unregister(key);
        return;
      }
      actions.current.set(key, operation);
      setStore((current) => {
        if (current.scope !== scope) return current;
        const previous = current.items.get(key);
        if (
          previous?.sectionPath === status.sectionPath &&
          previous.valid === status.valid &&
          previous.pending === status.pending
        )
          return current;
        const items = new Map(current.items);
        items.set(key, status);
        return { ...current, items };
      });
    },
    [scope, unregister],
  );
  const discardAll = () => {
    for (const operation of actions.current.values()) operation.discard();
    actions.current.clear();
    setStore({
      scope,
      drafts: new Map(),
      items: new Map(),
      errors: new Map(),
      failed: new Set(),
      applying: false,
    });
  };
  const pending =
    store.applying || [...store.items.values()].some((item) => item.pending);
  useEditSession("settings", {
    label: t("settings.title"),
    dirty: store.drafts.size > 0 || store.items.size > 0,
    canSave: false,
    pending,
    blocksNavigation: (nextPath) => !/^\/settings(?:\/|$)/.test(nextPath),
    save: async () => {},
    flush: async () => {},
    discard: async () => {
      discardAll();
    },
  });
  return (
    <Drafts.Provider
      value={{
        ...store,
        applying: pending,
        set,
        register,
        unregister,
        discardAll,
        async apply() {
          if (applying.current || currentScope.current !== scope) return;
          applying.current = true;
          setStore((current) => ({ ...current, applying: true }));
          for (const key of [...actions.current.keys()]) {
            if (currentScope.current !== scope) break;
            // 秘密行离页注销；等待前一项期间卸载的编辑器不再提交。
            const operation = actions.current.get(key);
            if (!operation) continue;
            const result = await operation.save();
            if (currentScope.current !== scope) break;
            if (result === null) {
              set(key, null);
              continue;
            }
            setStore((current) => {
              if (current.scope !== scope) return current;
              const failed = new Set(current.failed);
              failed.add(key);
              const errors = new Map(current.errors);
              if (result !== false) errors.set(key, result);
              const items = new Map(current.items);
              const item = items.get(key);
              if (item)
                items.set(key, {
                  ...item,
                  pending: false,
                  valid:
                    result !== false &&
                    result.code !== "app.data.version_conflict" &&
                    item.valid,
                });
              return { ...current, failed, errors, items };
            });
          }
          if (currentScope.current === scope) {
            applying.current = false;
            setStore((current) => ({ ...current, applying: false }));
          }
        },
      }}
    >
      {children}
    </Drafts.Provider>
  );
}

export function useSettingsDrafts() {
  const context = useContext(Drafts);
  if (!context) throw new Error("SettingsDraftProvider is required");
  return context;
}

// 仅非秘密参数调用；秘密值只留在编辑器本地，离页注销其操作。
export function useParamDraft(entry: ParamEntry) {
  const context = useSettingsDrafts();
  const { pathname } = useLocation();
  const stored = context.drafts.get(entry.key);
  const draft = stored ?? {
    value: entry.value as string,
    baseVersion: entry.rowVersion,
    sectionPath: pathname,
  };
  return {
    draft,
    dirty: stored !== undefined,
    setValue(value: string) {
      context.set(
        entry.key,
        value === entry.value ? null : { ...draft, value },
      );
    },
    accept(accepted: ParamEntry) {
      context.set(accepted.key, null);
    },
    discard() {
      context.set(entry.key, null);
    },
  };
}
