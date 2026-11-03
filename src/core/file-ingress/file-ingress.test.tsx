import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import type { AppModules } from "@/lib/generated/AppModules";
import type { AppSettings } from "@/lib/generated/AppSettings";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import { authKey } from "../auth";
import { activeAuth, currentUser } from "../core.test-support";
import { emitWindowEvent } from "../window-events";
import { visibleFileTargets } from ".";
import {
  fileManifest,
  incoming,
  setupIngress,
} from "./file-ingress.test-support";

test("file targets share route, module, developer, and action permission visibility", () => {
  const modules = [fileManifest],
    enabled = new Set(["files"]);
  const auth = {
    authenticated: true,
    developerMode: true,
    mode: "none" as const,
    permissions: ["files.file.read", "files.file.write"],
  };
  expect(
    visibleFileTargets(modules, enabled, auth).map((target) => target.id),
  ).toEqual(["files.add"]);
  expect(
    visibleFileTargets(modules, enabled, { ...auth, developerMode: false }),
  ).toEqual([]);
  expect(
    visibleFileTargets(modules, enabled, { ...auth, authenticated: false }),
  ).toEqual([]);
  for (const permission of auth.permissions) {
    expect(
      visibleFileTargets(modules, enabled, {
        ...auth,
        permissions: auth.permissions.filter((value) => value !== permission),
      }),
    ).toEqual([]);
  }
  expect(visibleFileTargets(modules, new Set(["account"]), auth)).toEqual([]);
  expect(
    visibleFileTargets([{ ...fileManifest, devPages: [] }], enabled, auth),
  ).toEqual([]);
});

test("unknown URI routes cannot navigate or claim files", async () => {
  const f = setupIngress({
    pending: [{ type: "route", id: "route", path: "/not-registered/execute" }],
    recent: [],
    issue: null,
    skippedDirectories: 0,
  });
  const dialog = within(
    await screen.findByRole("dialog", { name: "打开文件" }),
  );
  expect(dialog.getByRole("button", { name: "打开页面" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByTestId("location").textContent).toBe("/");
  expect(
    f.calls.mock.calls.some(
      ([command]) => command === "app_file_ingress_claim",
    ),
  ).toBe(false);
});

test("claim uses the target purpose and transfers only the host token until consumed", async () => {
  const f = setupIngress({
    pending: [
      { type: "file", id: "file-1", name: "rows.csv", extension: "csv" },
    ],
    recent: [],
    issue: null,
    skippedDirectories: 0,
  });
  const dialog = within(
    await screen.findByRole("dialog", { name: "打开文件" }),
  );
  fireEvent.click(await dialog.findByRole("button", { name: /交给/ }));
  await waitFor(() =>
    expect(screen.getByTestId("incoming").textContent).toBe(incoming.token),
  );
  expect(f.calls).toHaveBeenCalledWith("app_file_ingress_claim", {
    input: { id: "file-1", purpose: "store" },
  });
  expect(screen.getByTestId("location").textContent).toBe("/files");
  fireEvent.click(screen.getByRole("button", { name: "consume" }));
  expect(screen.getByTestId("incoming").textContent).toBe("");
});

test.each(["identity", "permission", "directory", "developer mode", "module"])(
  "late claims are discarded after %s changes",
  async (change) => {
    let resolveClaim!: (file: typeof incoming) => void;
    const f = setupIngress(
      {
        pending: [
          { type: "file", id: "file-1", name: "rows.csv", extension: "csv" },
        ],
        recent: [],
        issue: null,
        skippedDirectories: 0,
      },
      (command) =>
        command === "app_file_ingress_claim"
          ? new Promise((resolve) => {
              resolveClaim = resolve;
            })
          : undefined,
    );
    fireEvent.click(await screen.findByRole("button", { name: /交给/ }));
    await waitFor(() => expect(resolveClaim).toBeDefined());
    await act(async () => {
      if (change === "directory") f.rerender(f.tree([]));
      else if (change === "developer mode")
        f.client.setQueryData<AppSettings>(
          ["app", "settings"],
          (settings) =>
            settings && {
              ...settings,
              developerMode: { value: false, source: "file" },
            },
        );
      else if (change === "module")
        f.client.setQueryData<AppModules>(["app", "modules"], { modules: [] });
      else
        f.client.setQueryData<AuthStatus>(
          authKey,
          change === "identity"
            ? {
                ...activeAuth,
                user: { ...currentUser, id: "another-owner" },
              }
            : { ...activeAuth, permissions: ["files.file.read"] },
        );
    });
    await act(async () => {
      resolveClaim(incoming);
    });
    expect(screen.getByTestId("incoming").textContent).toBe("");
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(f.consumed).not.toHaveBeenCalled();
  },
);

test("a transferred token is discarded when its target is removed", async () => {
  const f = setupIngress({
    pending: [
      { type: "file", id: "file-1", name: "rows.csv", extension: "csv" },
    ],
    recent: [],
    issue: null,
    skippedDirectories: 0,
  });
  fireEvent.click(await screen.findByRole("button", { name: /交给/ }));
  await waitFor(() =>
    expect(screen.getByTestId("incoming").textContent).toBe(incoming.token),
  );
  f.rerender(f.tree([]));
  expect(screen.getByTestId("incoming").textContent).toBe("");
  f.rerender(f.tree());
  expect(screen.getByTestId("incoming").textContent).toBe("");
});

test("typed host events refresh the queue; reopening and clearing recent files use host commands", async () => {
  const f = setupIngress();
  await waitFor(() => expect(f.client.isFetching()).toBe(0));
  f.snapshot.recent = [
    { type: "file", id: "recent-1", name: "rows.csv", extension: "csv" },
  ];
  await act(async () => {
    emitWindowEvent("tenon:files-changed", { type: "files_changed" });
  });
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  fireEvent.click(await screen.findByRole("button", { name: "重新打开" }));
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_file_recent_open", {
      input: { id: "recent-1" },
    }),
  );
  await waitFor(() => expect(f.client.isFetching()).toBe(0));
  expect(
    within(screen.getByRole("region", { name: "待处理" })).getByText(
      "rows.csv",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清空最近记录" }));
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("app_file_ingress_dismiss", {
      input: { ids: [], clearRecent: true },
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "重新打开" })).toBeNull(),
  );
  f.unmount();
  const count = f.calls.mock.calls.length;
  await act(async () => {
    emitWindowEvent("tenon:files-changed", { type: "files_changed" });
  });
  expect(f.calls.mock.calls.length).toBe(count);
});

test("unsupported extensions stay unclaimed and host errors remain visible", async () => {
  const f = setupIngress(
    {
      pending: [
        { type: "file", id: "file-1", name: "photo.png", extension: "png" },
      ],
      recent: [],
      issue: "app.file_ingress.limit",
      skippedDirectories: 2,
    },
    (command) => {
      if (command === "app_file_ingress_dismiss")
        throw {
          code: "app.file_ingress.unavailable",
          params: {},
          traceId: "ingress-error",
        };
    },
  );
  const dialog = within(
    await screen.findByRole("dialog", { name: "打开文件" }),
  );
  expect(dialog.queryByRole("button", { name: /交给/ })).toBeNull();
  expect(dialog.getByText(/已跳过 2/)).toBeTruthy();
  expect(dialog.getByText("一次打开的文件过多，请分批处理。")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "忽略" }));
  expect(await dialog.findByText("文件已不可用，请重新选择。")).toBeTruthy();
  expect(
    f.calls.mock.calls.some(
      ([command]) => command === "app_file_ingress_claim",
    ),
  ).toBe(false);
});

test("allowed URI routes dismiss the queue entry before navigating", async () => {
  const f = setupIngress({
    pending: [{ type: "route", id: "route", path: "/files" }],
    recent: [],
    issue: null,
    skippedDirectories: 0,
  });
  const open = await screen.findByRole("button", { name: "打开页面" });
  await waitFor(() => expect(open).toHaveProperty("disabled", false));
  fireEvent.click(open);
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe("/files"),
  );
  expect(f.calls).toHaveBeenCalledWith("app_file_ingress_dismiss", {
    input: { ids: ["route"], clearRecent: false },
  });
});

test("inactive identities do not query or expose file ingress", async () => {
  const f = setupIngress(undefined, (command) =>
    command === "account_auth_status"
      ? { ...activeAuth, state: "locked", permissions: [] }
      : undefined,
  );
  await waitFor(() => expect(f.client.isFetching()).toBe(0));
  expect(
    f.calls.mock.calls.some(([command]) => command === "app_file_ingress_list"),
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "打开文件" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
