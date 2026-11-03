import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { KeyboardSettings } from "@/lib/generated/KeyboardSettings";
import { authKey } from "./auth";
import {
  activeAuth,
  currentUser,
  mockAppIpc,
  queryWrapper,
} from "./core.test-support";
import { useKeyboardSettings } from "./keyboard-settings";

it("scopes keyboard settings to the active subject and disables inactive reads", async () => {
  const calls = mockAppIpc();
  const { wrapper, client } = queryWrapper();
  const { result } = renderHook(useKeyboardSettings, { wrapper });
  expect(result.current.canEdit).toBe(false);
  await waitFor(() => expect(result.current.canEdit).toBe(true));
  expect(
    client.getQueryData(["app", "keyboard", activeAuth.user?.id]),
  ).toBeDefined();
  const reads = calls.mock.calls.filter(
    ([command]) => command === "app_keyboard_get",
  ).length;
  act(() =>
    client.setQueryData<AuthStatus>(authKey, {
      ...activeAuth,
      state: "locked",
    }),
  );
  await waitFor(() => expect(result.current.canEdit).toBe(false));
  expect(result.current.query.data).toBeUndefined();
  expect(
    calls.mock.calls.filter(([command]) => command === "app_keyboard_get"),
  ).toHaveLength(reads);
});

it("updates the acknowledged revision and refetches on conflict", async () => {
  mockAppIpc();
  const { wrapper } = queryWrapper();
  const { result } = renderHook(useKeyboardSettings, { wrapper });
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  const bindings = [{ commandId: "nav:home", keys: "Control+h" }];
  await act(() =>
    result.current.update.mutateAsync({ expectedRevision: 0, bindings }),
  );
  await waitFor(() =>
    expect(result.current.query.data?.snapshot.revision).toBe(1),
  );
  act(() =>
    result.current.update.mutate({ expectedRevision: 0, bindings: [] }),
  );
  await waitFor(() =>
    expect(result.current.update.error?.code).toBe("app.keyboard.conflict"),
  );
  expect(result.current.query.data?.snapshot.bindings).toEqual(bindings);
});

it("late writes update only the initiating subject's cache", async () => {
  let complete!: (value: KeyboardSettings) => void;
  mockAppIpc((command) => {
    if (command === "app_keyboard_update")
      return new Promise((resolve) => {
        complete = resolve;
      });
  });
  const { wrapper, client } = queryWrapper();
  const { result } = renderHook(useKeyboardSettings, { wrapper });
  await waitFor(() => expect(result.current.canEdit).toBe(true));
  act(() =>
    result.current.update.mutate({ expectedRevision: 0, bindings: [] }),
  );
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  act(() =>
    client.setQueryData<AuthStatus>(authKey, {
      ...activeAuth,
      user: { ...currentUser, id: "other-user" },
    }),
  );
  await waitFor(() =>
    expect(
      client.getQueryData(["app", "keyboard", "other-user"]),
    ).toBeDefined(),
  );
  await act(() =>
    complete({
      canEdit: true,
      snapshot: { schemaVersion: 1, revision: 5, bindings: [] },
    }),
  );
  expect(
    client.getQueryData<KeyboardSettings>(["app", "keyboard", "other-user"])
      ?.snapshot.revision,
  ).toBe(0);
});
