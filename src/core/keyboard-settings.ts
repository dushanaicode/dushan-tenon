import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStatus } from "@/core/auth";
import { appKeyboardGet, appKeyboardUpdate } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { KeyboardSettings } from "@/lib/generated/KeyboardSettings";
import type { KeyboardUpdate } from "@/lib/generated/KeyboardUpdate";

export function useKeyboardSettings() {
  const auth = useAuthStatus();
  const client = useQueryClient();
  const subject =
    auth.data?.state === "active" ? auth.data.user?.id : undefined;
  const queryKey = ["app", "keyboard", subject];
  const query = useQuery<KeyboardSettings, IpcError>({
    queryKey,
    queryFn: appKeyboardGet,
    enabled: subject !== undefined,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const update = useMutation<KeyboardSettings, IpcError, KeyboardUpdate>({
    mutationKey: queryKey,
    scope: { id: `keyboard:${subject}` },
    mutationFn: appKeyboardUpdate,
    onSuccess: (saved) => client.setQueryData(queryKey, saved),
    onError: (error) => {
      if (error.code === "app.keyboard.conflict") void query.refetch();
    },
  });
  return {
    query,
    update,
    canEdit: subject !== undefined && query.data?.canEdit === true,
  };
}
