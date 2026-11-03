import {
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { authKey } from "@/core/auth";

const authErrors = new Set([
  "app.permission.denied",
  "account.auth.required",
  "account.session.locked",
  "account.session.expired",
  "account.auth.init_required",
  "account.auth.confirm_required",
]);

export function createQueryClient(options: QueryClientConfig = {}) {
  function onError(error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      authErrors.has(error.code)
    ) {
      void client.invalidateQueries({ queryKey: authKey });
    }
  }
  const client = new QueryClient({
    ...options,
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  });
  return client;
}
