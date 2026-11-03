import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import {
  authKey,
  refreshAuth,
  useAuthStatus,
  usePermission,
  useSessionActions,
} from "./auth";
import { activeAuth, mockAppIpc, queryWrapper } from "./core.test-support";

it("retains verified permissions only for maintenance busy and rejects other refresh errors", async () => {
  let code: string | undefined;
  mockAppIpc((command) => {
    if (command === "account_auth_status" && code)
      throw { code, params: {}, traceId: "auth-refresh" };
  });
  const { wrapper, client } = queryWrapper();
  const { result } = renderHook(
    () => ({ auth: useAuthStatus(), allowed: usePermission("ai.chat.use") }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.allowed).toBe(true));
  code = "app.operation.busy";
  await act(() => client.invalidateQueries({ queryKey: authKey }));
  await waitFor(() => expect(result.current.auth.error?.code).toBe(code));
  expect(result.current.allowed).toBe(true);
  code = "app.internal.unexpected";
  await act(() => client.invalidateQueries({ queryKey: authKey }));
  await waitFor(() => expect(result.current.allowed).toBe(false));
});

it("initial maintenance busy cannot invent an authenticated permission grant", async () => {
  mockAppIpc((command) => {
    if (command === "account_auth_status")
      throw { code: "app.operation.busy", params: {}, traceId: "initial-busy" };
  });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(
    () => ({ auth: useAuthStatus(), allowed: usePermission("ai.chat.use") }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.auth.isError).toBe(true));
  expect(result.current.allowed).toBe(false);
});

it("shares the auth query and refuses permissions for inactive or failed auth", async () => {
  const calls = mockAppIpc();
  const { wrapper, client } = queryWrapper();
  const { result } = renderHook(
    () => ({ auth: useAuthStatus(), allowed: usePermission("ai.chat.use") }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.allowed).toBe(true));
  expect(
    calls.mock.calls.filter(([name]) => name === "account_auth_status"),
  ).toHaveLength(1);
  act(() =>
    client.setQueryData<AuthStatus>(authKey, {
      ...activeAuth,
      state: "locked",
    }),
  );
  await waitFor(() => expect(result.current.allowed).toBe(false));
  act(() =>
    client.setQueryData<AuthStatus>(authKey, {
      ...activeAuth,
      permissions: [],
    }),
  );
  await waitFor(() => expect(result.current.allowed).toBe(false));
});

it.each(["lock", "logout"] as const)(
  "%s refreshes auth and the current profile only after success",
  async (action) => {
    const calls = mockAppIpc();
    const { wrapper, client } = queryWrapper();
    client.setQueryData(["account", "user", "me"], activeAuth.user);
    const { result } = renderHook(
      () => ({ auth: useAuthStatus(), mutation: useSessionActions() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.auth.isSuccess).toBe(true));
    await act(() => result.current.mutation.mutateAsync(action));
    await waitFor(() =>
      expect(result.current.auth.data?.state).toBe(
        action === "lock" ? "locked" : "anonymous",
      ),
    );
    expect(
      calls.mock.calls.filter(
        ([name]) =>
          name ===
          (action === "lock" ? "account_session_lock" : "account_auth_logout"),
      ),
    ).toHaveLength(1);
    expect(client.getQueryState(["account", "user", "me"])?.isInvalidated).toBe(
      true,
    );
  },
);

it("retains authenticated facts when a session action fails and exposes the IPC error", async () => {
  mockAppIpc((command) => {
    if (command === "account_session_lock")
      throw {
        code: "app.internal.unexpected",
        params: {},
        traceId: "lock-failure",
      };
  });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(
    () => ({ auth: useAuthStatus(), mutation: useSessionActions() }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.auth.isSuccess).toBe(true));
  act(() => result.current.mutation.mutate("lock"));
  await waitFor(() =>
    expect(result.current.mutation.error?.traceId).toBe("lock-failure"),
  );
  expect(result.current.auth.data?.state).toBe("active");
});

it("refreshAuth invalidates both identity readouts", async () => {
  const { client } = queryWrapper();
  client.setQueryData(authKey, activeAuth);
  client.setQueryData(["account", "user", "me"], activeAuth.user);
  await refreshAuth(client);
  expect(client.getQueryState(authKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(["account", "user", "me"])?.isInvalidated).toBe(
    true,
  );
});

it.each(["app.permission.denied", "account.session.expired"])(
  "query and mutation errors %s invalidate auth without dropping unrelated state",
  async (code) => {
    const { client } = queryWrapper();
    const failure = { code, params: {}, traceId: "auth-failure" };
    client.setQueryData(authKey, activeAuth);
    client.setQueryData(["unrelated"], 42);
    await expect(
      client.fetchQuery({
        queryKey: ["protected"],
        queryFn: () => Promise.reject(failure),
        retry: false,
      }),
    ).rejects.toEqual(failure);
    expect(client.getQueryState(authKey)?.isInvalidated).toBe(true);
    client.setQueryData(authKey, activeAuth);
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(failure) });
    await expect(mutation.execute(undefined)).rejects.toEqual(failure);
    expect(client.getQueryState(authKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(["unrelated"])).toBe(42);
  },
);
