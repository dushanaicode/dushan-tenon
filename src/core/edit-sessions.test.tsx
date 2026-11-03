import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { authKey } from "@/core/auth";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import { mockAppIpc } from "./core.test-support";
import { EditSessionsProvider, useEditSession } from "./edit-sessions";
import { createQueryClient } from "./query-client";
import { emitWindowEvent } from "./window-events";

const requestId = "1240521e-7199-4966-9c82-78fd006058f4";

it("unmount during save rejects native close and cannot later publish a false clean state", async () => {
  const f = setup();
  await edit();
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: true, pending: false },
    }),
  );
  let complete!: () => void;
  f.save.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  act(() =>
    emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "保存并离开",
    }),
  );
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  f.calls.mockClear();
  f.unmount();
  await act(async () => complete());
  expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
    input: { requestId, proceed: false },
  });
  expect(f.calls).not.toHaveBeenCalledWith("app_window_edit_decide", {
    input: { requestId, proceed: true },
  });
  expect(f.calls).not.toHaveBeenCalledWith("app_window_edit_state", {
    input: { dirty: false, pending: false },
  });
  f.client.clear();
});

it("new local edits during a clean acknowledgement keep the close handshake open", async () => {
  let hold = false;
  let complete!: () => void;
  const f = setup((command, payload) => {
    if (
      hold &&
      command === "app_window_edit_state" &&
      !(payload as { input: { dirty: boolean } }).input.dirty
    ) {
      hold = false;
      return new Promise<null>((resolve) => {
        complete = () => resolve(null);
      });
    }
  });
  await waitFor(() =>
    expect(f.client.getQueryData<AuthStatus>(authKey)?.state).toBe("active"),
  );
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: false, pending: false },
    }),
  );
  hold = true;
  act(() =>
    emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
  );
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Document", hidden: true }),
    { target: { value: "late edit" } },
  );
  await act(async () => complete());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存并离开" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(f.calls).not.toHaveBeenCalledWith("app_window_edit_decide", {
    input: { requestId, proceed: true },
  });
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: false },
    }),
  );
  f.unmount();
  f.client.clear();
});

it("a delayed clean acknowledgement cannot approve a request cancelled by identity change", async () => {
  let hold = false;
  let complete!: () => void;
  const f = setup((command, payload) => {
    if (
      command === "app_window_edit_state" &&
      hold &&
      !(payload as { input: { dirty: boolean } }).input.dirty
    ) {
      hold = false;
      return new Promise<null>((resolve) => {
        complete = () => resolve(null);
      });
    }
  });
  await waitFor(() =>
    expect(f.client.getQueryData<AuthStatus>(authKey)?.state).toBe("active"),
  );
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: false, pending: false },
    }),
  );
  hold = true;
  act(() => {
    expect(
      emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
    ).toBe(true);
  });
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  act(() =>
    f.client.setQueryData<AuthStatus>(
      authKey,
      (current) =>
        current && { ...current, state: "locked", permissions: [], user: null },
    ),
  );
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: false },
    }),
  );
  await act(async () => complete());
  expect(f.calls).not.toHaveBeenCalledWith("app_window_edit_decide", {
    input: { requestId, proceed: true },
  });
  f.unmount();
  f.client.clear();
});

it("a failed final clean publication keeps the close decision unapproved and exposes its trace", async () => {
  let fail = false;
  const f = setup((command, payload) => {
    if (
      command === "app_window_edit_state" &&
      fail &&
      !(payload as { input: { dirty: boolean } }).input.dirty
    ) {
      throw {
        code: "app.internal.unexpected",
        params: {},
        traceId: "clean-failure",
      };
    }
  });
  await edit();
  fail = true;
  act(() =>
    emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "保存并离开",
    }),
  );
  await screen.findByText(/clean-failure/);
  expect(f.calls).not.toHaveBeenCalledWith("app_window_edit_decide", {
    input: { requestId, proceed: true },
  });
  fail = false;
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "继续编辑",
    }),
  );
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: false },
    }),
  );
  f.unmount();
  f.client.clear();
});

it("a save completing in an old permission scope cannot approve native close", async () => {
  const f = setup();
  await edit();
  let complete!: () => void;
  f.save.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  act(() =>
    emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "保存并离开",
    }),
  );
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  act(() =>
    f.client.setQueryData<AuthStatus>(
      authKey,
      (current) => current && { ...current, permissions: [] },
    ),
  );
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: false },
    }),
  );
  await act(async () => complete());
  expect(f.calls).not.toHaveBeenCalledWith("app_window_edit_decide", {
    input: { requestId, proceed: true },
  });
  f.unmount();
  f.client.clear();
});

function Editor({
  save,
  discard,
}: {
  save: () => Promise<void>;
  discard: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  useEditSession("test-editor", {
    label: "Test document",
    dirty: text !== "",
    canSave: true,
    pending: false,
    save: async () => {
      await save();
      setText("");
    },
    discard: async () => {
      await discard();
      setText("");
    },
    flush: async () => {},
  });
  return (
    <input
      aria-label="Document"
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
    />
  );
}

function setup(override?: Parameters<typeof mockAppIpc>[0]) {
  const calls = mockAppIpc(override),
    save = vi.fn(async () => {}),
    discard = vi.fn(async () => {});
  const client = createQueryClient();
  const router = createMemoryRouter([
    {
      element: (
        <EditSessionsProvider>
          <Outlet />
        </EditSessionsProvider>
      ),
      children: [
        { path: "/", element: <Editor save={save} discard={discard} /> },
        { path: "/other", element: <p>Other page</p> },
      ],
    },
  ]);
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls, save, discard, router, client, ...view };
}

async function edit() {
  fireEvent.change(await screen.findByRole("textbox", { name: "Document" }), {
    target: { value: "unfinished" },
  });
}

it("one route blocker preserves editing on cancel and waits for save before navigating", async () => {
  const f = setup();
  await edit();
  await act(async () => f.router.navigate("/other"));
  let dialog = within(await screen.findByRole("alertdialog"));
  fireEvent.click(dialog.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("textbox", { name: "Document" })).toHaveProperty(
    "value",
    "unfinished",
  );
  let finish!: () => void;
  f.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => f.router.navigate("/other"));
  dialog = within(await screen.findByRole("alertdialog"));
  fireEvent.click(dialog.getByRole("button", { name: "保存并离开" }));
  expect(f.router.state.location.pathname).toBe("/");
  await act(async () => finish());
  await screen.findByText("Other page");
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.discard).not.toHaveBeenCalled();
  await waitFor(() => {
    const signals = f.calls.mock.calls.filter(
      ([name]) => name === "app_window_edit_state",
    );
    expect(signals.at(-1)?.[1]).toEqual({
      input: { dirty: false, pending: false },
    });
  });
  f.unmount();
  f.client.clear();
});

it("failed saves leave the route and dirty document intact", async () => {
  const f = setup();
  await edit();
  f.save.mockRejectedValue({
    code: "app.data.version_conflict",
    params: {},
    traceId: "edit-conflict",
  });
  await act(async () => f.router.navigate("/other"));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "保存并离开",
    }),
  );
  await screen.findByText(/edit-conflict/);
  expect(f.router.state.location.pathname).toBe("/");
  expect(
    screen.getByRole("textbox", { name: "Document", hidden: true }),
  ).toHaveProperty("value", "unfinished");
  f.unmount();
  f.client.clear();
});

it("native close waits for the clean-state IPC acknowledgement before consuming its request", async () => {
  let hold = false,
    acknowledge!: () => void;
  const f = setup((command, payload) => {
    if (
      command === "app_window_edit_state" &&
      hold &&
      !(payload as { input: { dirty: boolean } }).input.dirty
    )
      return new Promise<null>((resolve) => {
        acknowledge = () => resolve(null);
      });
  });
  await edit();
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: true, pending: false },
    }),
  );
  hold = true;
  act(() =>
    emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "保存并离开",
    }),
  );
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(acknowledge).toBeTypeOf("function"));
  expect(
    f.calls.mock.calls.some(
      ([command]) => command === "app_window_edit_decide",
    ),
  ).toBe(false);
  hold = false;
  await act(async () => acknowledge());
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: true },
    }),
  );
  f.unmount();
  f.client.clear();
});

it("a close handshake sees local edits while the first dirty-state publication is still delayed", async () => {
  let release!: () => void;
  let first = true;
  const f = setup((command, payload) => {
    if (
      command === "app_window_edit_state" &&
      (payload as { input: { dirty: boolean } }).input.dirty &&
      first
    ) {
      first = false;
      return new Promise<null>((resolve) => {
        release = () => resolve(null);
      });
    }
  });
  await edit();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  act(() => {
    expect(
      emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
    ).toBe(true);
  });
  const dialog = within(await screen.findByRole("alertdialog"));
  expect(
    f.calls.mock.calls.some(([name]) => name === "app_window_edit_decide"),
  ).toBe(false);
  fireEvent.click(dialog.getByRole("button", { name: "继续编辑" }));
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: false },
    }),
  );
  expect(screen.getByRole("textbox", { name: "Document" })).toHaveProperty(
    "value",
    "unfinished",
  );
  await act(async () => release());
  f.unmount();
  f.client.clear();
});

it("native cancellation consumes only the request and retains the dirty editor", async () => {
  const f = setup();
  await edit();
  act(() =>
    emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
  );
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "继续编辑",
    }),
  );
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
      input: { requestId, proceed: false },
    }),
  );
  expect(screen.getByRole("textbox", { name: "Document" })).toHaveProperty(
    "value",
    "unfinished",
  );
  expect(f.save).not.toHaveBeenCalled();
  expect(f.discard).not.toHaveBeenCalled();
  f.unmount();
  f.client.clear();
});

it("identity lock cancels an open native decision and stops exposing the old editor", async () => {
  const f = setup();
  await edit();
  await waitFor(() =>
    expect(f.client.getQueryData<AuthStatus>(authKey)?.state).toBe("active"),
  );
  act(() =>
    emitWindowEvent("tenon:edit-close", { type: "close_edit", requestId }),
  );
  await screen.findByRole("alertdialog");
  act(() =>
    f.client.setQueryData<AuthStatus>(
      authKey,
      (current) =>
        current && { ...current, state: "locked", user: null, permissions: [] },
    ),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: false, pending: false },
    }),
  );
  expect(f.calls).toHaveBeenCalledWith("app_window_edit_decide", {
    input: { requestId, proceed: false },
  });
  expect(
    f.calls.mock.calls.some(
      ([command, args]) =>
        command === "app_window_edit_decide" &&
        (args as { input: { proceed: boolean } }).input.proceed,
    ),
  ).toBe(false);
  expect(f.save).not.toHaveBeenCalled();
  expect(f.discard).not.toHaveBeenCalled();
  f.unmount();
  f.client.clear();
});

it("an error-boundary style unmount preserves the last dirty guard for the still-active identity", async () => {
  const f = setup();
  await edit();
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: true, pending: false },
    }),
  );
  f.calls.mockClear();
  f.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    f.calls.mock.calls.some(
      ([name, args]) =>
        name === "app_window_edit_state" &&
        !(args as { input: { dirty: boolean } }).input.dirty,
    ),
  ).toBe(false);
  f.client.clear();
});

it("a verified lock followed by provider unmount releases the old identity's guard", async () => {
  const f = setup();
  await edit();
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: true, pending: false },
    }),
  );
  f.calls.mockClear();
  act(() => {
    f.client.setQueryData<AuthStatus>(
      authKey,
      (current) =>
        current && { ...current, state: "locked", user: null, permissions: [] },
    );
    f.unmount();
  });
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_window_edit_state", {
      input: { dirty: false, pending: false },
    }),
  );
  f.client.clear();
});
