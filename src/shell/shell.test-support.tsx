import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";
import {
  activeAuth,
  currentUser,
  mockAppIpc,
  queryWrapper,
} from "@/core/core.test-support";
import { testManifest } from "@/core/module-directory.test-support";
import { PageHeader } from "@/kit";
import type { Titlebar } from "@/lib/generated/Titlebar";
import type { WorkbenchSnapshot } from "@/lib/generated/WorkbenchSnapshot";
import type { WorkbenchUpdate } from "@/lib/generated/WorkbenchUpdate";
import { WORKBENCH_DEFAULTS } from "@/lib/generated/workbench";
import { Shell, type ShellRootProps } from "./shell";
import { WindowChromeProvider } from "./window/window-chrome";

const observers = new Set<() => void>();
let width = 1200;
beforeEach(() => {
  width = 1200;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, width, 720),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      target: Element | null = null;
      notify = () => {
        if (this.target)
          this.callback(
            [
              {
                target: this.target,
                contentRect: new DOMRect(0, 0, width, 720),
                borderBoxSize: [{ inlineSize: width, blockSize: 720 }],
                contentBoxSize: [{ inlineSize: width, blockSize: 720 }],
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
      };
      observe(target: Element) {
        this.target = target;
        observers.add(this.notify);
      }
      unobserve() {
        this.disconnect();
      }
      disconnect() {
        this.target = null;
        observers.delete(this.notify);
      }
    },
  );
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
});
afterEach(() => {
  observers.clear();
  vi.unstubAllGlobals();
});
export function resizeShell(value: number) {
  act(() => {
    width = value;
    for (const notify of observers) notify();
  });
}
export const visibility = {
  authenticated: true,
  developerMode: true,
  mode: "none" as const,
  permissions: activeAuth.permissions,
};
export const job = { kind: "job" as const, id: currentUser.id };
export const manifest = testManifest({
  workbenchObjects: [
    {
      kind: "job",
      route: "/devtools/jobs/:id",
      resolve: async (ref) => ({
        ref,
        title: `任务 ${ref.id}`,
        iconId: "jobs",
      }),
      Component: async () => ({
        default: ({ object }) => <PageHeader title={object.title} />,
      }),
    },
  ],
  workbenchPanels: [
    {
      id: "inspector",
      order: 1,
      labelKey: "shell.panels.title",
      iconId: "jobs",
      objectKind: "job",
      permission: "devtools.job.read",
      Component: async () => ({
        default: ({ object }) => <p>检查 {object.ref.id}</p>,
      }),
    },
  ],
});
export function mockShellIpc(
  override?: Parameters<typeof mockAppIpc>[0],
  initial: Partial<WorkbenchSnapshot> = {},
) {
  let snapshot: WorkbenchSnapshot = structuredClone({
    ...WORKBENCH_DEFAULTS,
    objects: [],
    ...initial,
  });
  const calls = mockAppIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    if (command === "app_window_watch") return null;
    if (command === "app_workbench_get") return structuredClone(snapshot);
    if (command === "app_workbench_reset_layout") {
      snapshot = {
        ...snapshot,
        layouts: structuredClone(WORKBENCH_DEFAULTS.layouts),
        auxiliary: structuredClone(WORKBENCH_DEFAULTS.auxiliary),
        revision: snapshot.revision + 1,
      };
      return structuredClone(snapshot);
    }
    if (command === "app_workbench_update") {
      const { input } = payload as { input: WorkbenchUpdate };
      if (input.expectedRevision !== snapshot.revision)
        throw {
          code: "app.workbench.conflict",
          params: {},
          traceId: "test-conflict",
        };
      const change = input.change;
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        ...(change.kind === "set-layout"
          ? { layouts: { ...snapshot.layouts, ...change.layout } }
          : change.kind === "set-objects"
            ? { objects: change.objects, activeObject: change.activeObject }
            : { auxiliary: change.auxiliary }),
      };
      return structuredClone(snapshot);
    }
  });
  return { calls, snapshot: () => snapshot };
}
function Page() {
  const { pathname } = useLocation();
  return <PageHeader title={pathname} />;
}
export function renderShell(
  patch: Partial<ShellRootProps> = {},
  path = "/",
  children: ReactNode = <Page />,
  titlebar: Titlebar = "native",
) {
  const { client, wrapper: Wrapper } = queryWrapper();
  const props: ShellRootProps = {
    userId: currentUser.id,
    manifests: [manifest],
    enabled: new Set(["devtools"]),
    auth: visibility,
    tree: {
      groups: [
        {
          id: "host",
          items: [
            {
              kind: "leaf",
              id: "home",
              path: "/",
              label: "nav.home",
              iconId: "home",
            },
            {
              kind: "leaf",
              id: "files",
              path: "/files",
              label: "files.title",
              iconId: "files",
            },
          ],
        },
      ],
      footer: [
        {
          kind: "leaf",
          id: "settings",
          path: "/settings",
          label: "nav.settings",
          iconId: "settings",
        },
      ],
    },
    slots: { brand: "Tenon", headerEnd: null },
    sections: [],
    children,
    ...patch,
  };
  const content = (value: ShellRootProps) => (
    <Wrapper>
      <MemoryRouter initialEntries={[path]}>
        <WindowChromeProvider platform="windows" titlebar={titlebar}>
          <Shell {...value} />
        </WindowChromeProvider>
      </MemoryRouter>
    </Wrapper>
  );
  let current = props;
  const view = render(content(current));
  return {
    ...view,
    client,
    update: (value: Partial<ShellRootProps>) => {
      current = { ...current, ...value };
      view.rerender(content(current));
    },
  };
}
