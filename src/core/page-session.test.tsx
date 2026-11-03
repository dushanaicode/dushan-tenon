import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useLayoutEffect, useRef } from "react";
import { expect, it, vi } from "vitest";
import { authKey } from "@/core/auth";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import { currentUser } from "./core.test-support";
import { usePageSession, usePageSessionScope } from "./page-session";
import { createQueryClient } from "./query-client";

const actor = currentUser.id;
const key = ["page-session", actor, "test.list"];
const active: AuthStatus = {
  mode: "none",
  state: "active",
  user: currentUser,
  permissions: [],
  idleLockMinutes: 15,
};

function View({ ready, rendered }: { ready: boolean; rendered: () => void }) {
  rendered();
  const scrollRef = useRef<HTMLElement | null>(null);
  const session = usePageSession(
    actor,
    "test.list",
    { page: 1, keyword: "" },
    scrollRef,
  );
  useLayoutEffect(
    () => (ready ? session.restoreScroll() : undefined),
    [ready, session.restoreScroll],
  );
  return (
    <main ref={scrollRef}>
      <p>
        {session.view.page}:{session.view.keyword}
      </p>
      <button
        type="button"
        onClick={() => session.update({ page: 2, keyword: "applied" }, true)}
      >
        Apply
      </button>
    </main>
  );
}

it("restores typed view state and waits for loaded rows before restoring scroll without render-per-scroll", async () => {
  const client = createQueryClient(),
    rendered = vi.fn();
  let view = render(
    <QueryClientProvider client={client}>
      <View ready rendered={rendered} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText("2:applied");
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const count = rendered.mock.calls.length,
    main = screen.getByRole("main");
  for (const scrollTop of [180, 420, 630])
    fireEvent.scroll(main, { target: { scrollTop } });
  expect(rendered).toHaveBeenCalledTimes(count);
  expect(client.getQueryData<{ scrollTop: number }>(key)?.scrollTop).toBe(0);
  view.unmount();
  expect(client.getQueryData<{ scrollTop: number }>(key)?.scrollTop).toBe(630);
  view = render(
    <QueryClientProvider client={client}>
      <View ready={false} rendered={rendered} />
    </QueryClientProvider>,
  );
  expect(screen.getByText("2:applied")).toBeTruthy();
  expect(screen.getByRole("main").scrollTop).toBe(0);
  view.rerender(
    <QueryClientProvider client={client}>
      <View ready rendered={rendered} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("main").scrollTop).toBe(630));
  view.rerender(
    <QueryClientProvider client={client}>
      <View ready={false} rendered={rendered} />
    </QueryClientProvider>,
  );
  fireEvent.scroll(screen.getByRole("main"), { target: { scrollTop: 0 } });
  view.rerender(
    <QueryClientProvider client={client}>
      <View ready rendered={rendered} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("main").scrollTop).toBe(630));
  view.unmount();
  client.clear();
});

function Scope() {
  usePageSessionScope(actor);
  return <View ready rendered={() => {}} />;
}

it("StrictMode replay keeps the active session while a locked identity clears all of its page sessions", async () => {
  const client = createQueryClient();
  client.setQueryData(authKey, active);
  client.setQueryData(key, {
    view: { page: 3, keyword: "restored" },
    scrollTop: 80,
  });
  client.setQueryData(["page-session", actor, "test.other"], {
    view: { page: 8 },
    scrollTop: 0,
  });
  client.setQueryData(["page-session", "other-actor", "test.list"], {
    view: { page: 9 },
    scrollTop: 0,
  });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Scope />
      </QueryClientProvider>
    </StrictMode>,
  );
  await screen.findByText("3:restored");
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText("2:applied");
  act(() =>
    client.setQueryData(authKey, { ...active, state: "locked", user: null }),
  );
  view.unmount();
  await waitFor(() =>
    expect(
      client.getQueryCache().findAll({ queryKey: ["page-session", actor] }),
    ).toHaveLength(0),
  );
  expect(
    client.getQueryData(["page-session", "other-actor", "test.list"]),
  ).toBeDefined();
  client.clear();
});
