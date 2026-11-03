import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef } from "react";
import { authKey, useAuthStatus } from "@/core/auth";
import type { AuthStatus } from "@/lib/generated/AuthStatus";

// Check the cache before continuations: identity notifications may not have rendered yet.
export function useDemoScope(userId: string) {
  const client = useQueryClient();
  const auth = useAuthStatus();
  const permissions = auth.data?.permissions.join(",");
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => {
    const current = client.getQueryData<AuthStatus>(authKey);
    return (
      mounted.current &&
      current?.state === "active" &&
      current.user?.id === userId &&
      current.permissions.join(",") === permissions
    );
  }, [client, permissions, userId]);
}
