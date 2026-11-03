import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import {
  accountAuthLogout,
  accountAuthStatus,
  accountSessionLock,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { PermissionKey } from "@/lib/generated/permissions";

export const authKey = ["account", "auth"];

export function useAuthStatus() {
  return useQuery<AuthStatus, IpcError>({
    queryKey: authKey,
    queryFn: accountAuthStatus,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: "always",
  });
}

export async function refreshAuth(client: QueryClient) {
  await client.invalidateQueries({ queryKey: authKey });
  await client.invalidateQueries({ queryKey: ["account", "user", "me"] });
}

export function usePermission(key: PermissionKey) {
  const auth = useAuthStatus();
  return (
    (auth.isSuccess || auth.error?.code === "app.operation.busy") &&
    auth.data?.state === "active" &&
    auth.data.permissions.includes(key)
  );
}

export function useSessionActions() {
  const client = useQueryClient();
  return useMutation<null, IpcError, "lock" | "logout">({
    mutationFn: (action) =>
      action === "lock" ? accountSessionLock() : accountAuthLogout(),
    onSuccess: () => refreshAuth(client),
    gcTime: 0,
  });
}
