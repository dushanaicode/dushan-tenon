import "@/core/core.test-support";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  appWorkbenchGet,
  appWorkbenchResetLayout,
  appWorkbenchUpdate,
} from "@/lib/generated/commands";
import type { WorkbenchSnapshot } from "@/lib/generated/WorkbenchSnapshot";
import { WORKBENCH_DEFAULTS } from "@/lib/generated/workbench";
import { useWorkbench, WorkbenchFeedback, WorkbenchProvider } from "./store";

vi.mock("@/lib/generated/commands", () => ({
  appWorkbenchGet: vi.fn(),
  appWorkbenchUpdate: vi.fn(),
  appWorkbenchResetLayout: vi.fn(),
}));
let snapshot: WorkbenchSnapshot;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  snapshot = structuredClone({ ...WORKBENCH_DEFAULTS, objects: [] });
  vi.mocked(appWorkbenchGet).mockImplementation(async () =>
    structuredClone(snapshot),
  );
  vi.mocked(appWorkbenchUpdate).mockImplementation(async (input) => {
    expect(input.expectedRevision).toBe(snapshot.revision);
    snapshot = {
      ...snapshot,
      revision: snapshot.revision + 1,
      ...(input.change.kind === "set-layout"
        ? { layouts: { ...snapshot.layouts, ...input.change.layout } }
        : input.change.kind === "set-objects"
          ? {
              objects: input.change.objects,
              activeObject: input.change.activeObject,
            }
          : { auxiliary: input.change.auxiliary }),
    };
    return structuredClone(snapshot);
  });
});
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

function Consumer() {
  const store = useWorkbench();
  return (
    <>
      <output>
        {store.snapshot.layouts.console.primaryWidth}:{store.snapshot.revision}
      </output>
      <button
        type="button"
        onClick={() => {
          void store.updateLayout({
            console: {
              primaryWidth: 300,
              primaryCollapsed: false,
            },
          });
        }}
      >
        save
      </button>
      <button
        type="button"
        onClick={() => {
          void store.updateLayout({
            console: {
              primaryWidth: 280,
              primaryCollapsed: false,
            },
          });
          void store.updateLayout({
            console: {
              primaryWidth: 320,
              primaryCollapsed: true,
            },
          });
        }}
      >
        queue
      </button>
      <button
        type="button"
        onClick={() => {
          const object = {
            kind: "job" as const,
            id: "01999000-1234-7000-8000-123456789abc",
          };
          void store.updateObjects({ objects: [object], activeObject: object });
          void store.updateLayout({
            console: {
              ...WORKBENCH_DEFAULTS.layouts.console,
              primaryWidth: 310,
            },
          });
        }}
      >
        objects-and-layout
      </button>
      <button
        type="button"
        onClick={() => {
          void store.updateAuxiliary({
            width: 400,
            panel: "job-inspector",
            visible: true,
          });
          const object = {
            kind: "job" as const,
            id: "01999000-1234-7000-8000-123456789abc",
          };
          void store.updateObjects({ objects: [object], activeObject: object });
          void store.updateLayout({
            console: {
              ...WORKBENCH_DEFAULTS.layouts.console,
              primaryWidth: 290,
            },
          });
          void store.updateAuxiliary({ visible: false });
        }}
      >
        auxiliary-and-layout
      </button>
      <button
        type="button"
        onClick={() => {
          void store.resetLayout();
        }}
      >
        reset
      </button>
      <WorkbenchFeedback />
    </>
  );
}
function setup(userId = "first") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const content = (subject: string) => (
    <QueryClientProvider client={client}>
      <WorkbenchProvider key={subject} userId={subject}>
        <Consumer />
      </WorkbenchProvider>
    </QueryClientProvider>
  );
  const view = render(content(userId));
  return {
    ...view,
    changeSubject: (subject: string) => view.rerender(content(subject)),
  };
}

it("serializes writes using the latest confirmed revision, and preserves a confirmed layout on failure", async () => {
  setup();
  await screen.findByText("224:0");
  fireEvent.click(screen.getByText("queue"));
  await screen.findByText("320:2");
  expect(
    vi
      .mocked(appWorkbenchUpdate)
      .mock.calls.map(([input]) => input.expectedRevision),
  ).toEqual([0, 1]);
  vi.mocked(appWorkbenchUpdate).mockRejectedValueOnce({
    code: "app.workbench.write_failed",
    params: {},
    traceId: "write-trace",
  });
  fireEvent.click(screen.getByText("save"));
  expect(await screen.findByText("320:2")).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "write-trace",
  );
  fireEvent.click(screen.getByText("重试保存布局"));
  await screen.findByText("300:3");
});

it("serialized_layout_and_object_changes_preserve_each_other", async () => {
  setup();
  await screen.findByText("224:0");
  fireEvent.click(screen.getByText("objects-and-layout"));
  await screen.findByText("310:2");
  expect(snapshot.layouts.console.primaryWidth).toBe(310);
  expect(snapshot.objects).toHaveLength(1);
  expect(snapshot.activeObject).toEqual(snapshot.objects[0]);
});

it("serialized_auxiliary_object_and_primary_changes_preserve_each_other", async () => {
  setup();
  await screen.findByText("224:0");
  fireEvent.click(screen.getByText("auxiliary-and-layout"));
  await screen.findByText("290:4");
  expect(snapshot.auxiliary).toEqual({
    width: 400,
    visible: false,
    panel: "job-inspector",
  });
  expect(snapshot.layouts.console.primaryWidth).toBe(290);
  expect(snapshot.objects).toHaveLength(1);
  expect(snapshot.auxiliary.width).toBe(400);
});

it("revision conflict requires explicit reload and never automatically overwrites the newer layout", async () => {
  setup();
  await screen.findByText("224:0");
  snapshot = {
    ...snapshot,
    revision: 7,
    layouts: {
      ...snapshot.layouts,
      console: {
        primaryWidth: 270,
        primaryCollapsed: false,
      },
    },
  };
  vi.mocked(appWorkbenchUpdate).mockRejectedValueOnce({
    code: "app.workbench.conflict",
    params: { revision: "7" },
    traceId: "conflict-trace",
  });
  fireEvent.click(screen.getByText("save"));
  await screen.findByRole("alert");
  expect(screen.queryByText("重试保存布局")).toBeNull();
  expect(appWorkbenchGet).toHaveBeenCalledTimes(1);
  expect(screen.getByText("224:0")).toBeTruthy();
  fireEvent.click(screen.getByText("重新读取布局"));
  await screen.findByText("270:7");
  fireEvent.click(screen.getByText("save"));
  await screen.findByText("300:8");
});

it("subject changes unmount old state immediately and late writes cannot replace the new scope", async () => {
  let finish: (value: WorkbenchSnapshot) => void = () => {
    throw new Error("write not started");
  };
  vi.mocked(appWorkbenchUpdate).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = setup();
  await screen.findByText("224:0");
  fireEvent.click(screen.getByText("save"));
  await waitFor(() => expect(appWorkbenchUpdate).toHaveBeenCalledTimes(1));
  snapshot = {
    ...snapshot,
    revision: 10,
    layouts: {
      ...snapshot.layouts,
      console: {
        primaryWidth: 350,
        primaryCollapsed: true,
      },
    },
  };
  view.changeSubject("second");
  expect(screen.queryByText("224:0")).toBeNull();
  await screen.findByText("350:10");
  await act(async () =>
    finish({
      ...WORKBENCH_DEFAULTS,
      objects: [],
      revision: 1,
      layouts: {
        ...WORKBENCH_DEFAULTS.layouts,
        console: {
          primaryWidth: 300,
          primaryCollapsed: false,
        },
      },
    }),
  );
  expect(screen.getByText("350:10")).toBeTruthy();
  expect(screen.queryByText("300:1")).toBeNull();
});

it("read failures expose the error; reset only uses the dedicated layout command", async () => {
  vi.mocked(appWorkbenchGet).mockRejectedValueOnce({
    code: "app.workbench.invalid",
    params: {},
    traceId: "bad-file",
  });
  setup();
  await screen.findByRole("alert");
  expect(screen.queryByText("224:0")).toBeNull();
  fireEvent.click(screen.getByText("重新读取布局"));
  await screen.findByText("224:0");
  vi.mocked(appWorkbenchResetLayout).mockResolvedValueOnce({
    ...WORKBENCH_DEFAULTS,
    objects: [],
    revision: 1,
  });
  fireEvent.click(screen.getByText("reset"));
  await screen.findByText("224:1");
  expect(appWorkbenchResetLayout).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: 0,
  });
  expect(appWorkbenchUpdate).not.toHaveBeenCalled();
});
