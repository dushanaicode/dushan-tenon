import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authKey } from "@/core/auth";
import {
  appSettingList,
  appSettingReset,
  appSettingSet,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { ParamEntry } from "@/lib/generated/ParamEntry";

export function sortParams(entries: readonly ParamEntry[]) {
  return [...entries].sort(
    (a, b) =>
      (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) ||
      a.order - b.order ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

export function useParamList(userId: string, includeDisabled: boolean) {
  return useQuery<ParamEntry[], IpcError>({
    queryKey: ["app", "setting", userId, includeDisabled],
    queryFn: async ({ signal }) => {
      const entries = await appSettingList({ includeDisabled });
      signal.throwIfAborted();
      return entries;
    },
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
  });
}

type Change = { action: "set" | "reset"; rowVersion: number | null };

export function useParamChange(
  userId: string,
  key: string,
  retainOnUnmount = false,
) {
  const client = useQueryClient();
  const mutationKey = ["app", "setting", userId, key];
  const pending = useIsMutating({ mutationKey }) > 0;
  // 值只在当前编辑器内暂存，尤其不能成为 MutationCache.variables 的秘密。
  const submittedValue = useRef("");
  const accepted = useRef<((entry: ParamEntry) => void) | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      // 非秘密草稿的已登记操作跨分节保留，秘密编辑器必须随卸载关闭。
      if (retainOnUnmount) return;
      active.current = false;
      submittedValue.current = "";
    };
  }, [retainOnUnmount]);
  const mutation = useMutation<ParamEntry, IpcError, Change>({
    mutationKey,
    scope: { id: `setting:${userId}:${key}` },
    retry: false,
    gcTime: 0,
    mutationFn: ({ action, rowVersion }) => {
      if (!active.current) {
        throw new DOMException("Setting editor closed", "AbortError");
      }
      const value = submittedValue.current;
      submittedValue.current = "";
      return action === "set"
        ? appSettingSet({ key, value, rowVersion })
        : appSettingReset({ key, rowVersion });
    },
    onSuccess: (entry) => {
      client.setQueriesData<ParamEntry[]>(
        { queryKey: ["app", "setting", userId] },
        (entries) => entries?.map((item) => (item.key === key ? entry : item)),
      );
      accepted.current?.(entry);
    },
    onSettled: async () => {
      submittedValue.current = "";
      accepted.current = null;
      // 报错也刷新事实：缓存失效可能在数据库提交之后失败。
      await client.invalidateQueries({
        queryKey: ["app", "setting", userId],
      });
      if (key === "account.idle_lock_minutes") {
        await client.invalidateQueries({ queryKey: authKey });
      }
    },
  });

  return {
    ...mutation,
    pending: pending || mutation.isPending,
    async save(
      value: string,
      rowVersion: number | null,
      accept: (entry: ParamEntry) => void,
    ) {
      submittedValue.current = value;
      accepted.current = accept;
      try {
        await mutation.mutateAsync({ action: "set", rowVersion });
        return null;
      } catch (error) {
        // 行内 mutation 与统一草稿栏共同保留具体失败。
        return error as IpcError;
      }
    },
    resetValue(rowVersion: number | null, accept: (entry: ParamEntry) => void) {
      accepted.current = accept;
      mutation.mutate({ action: "reset", rowVersion });
    },
  };
}
