import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { i18n } from "@/core/i18n";
import { createQueryClient } from "@/core/query-client";
import { AboutSection } from "./about-section";
import { buildDiagnosticText } from "./diagnostics";
import {
  about,
  appModules,
  currentUser,
  defaultSettings,
  mockAppIpc,
  renderApp,
} from "./settings.test-support";

const diagnosticPick = {
  token: "diagnostic-token",
  fileName: "diagnostics.tenon-diagnostics.zip",
  format: null,
};

const clients: ReturnType<typeof createQueryClient>[] = [];

function renderAbout() {
  const client = createQueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        refetchOnWindowFocus: "always",
      },
    },
  });
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AboutSection />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function mockClipboard(writeText?: (text: string) => Promise<void>) {
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue(
    (writeText ? { writeText } : undefined) as Clipboard,
  );
}

async function readyCopyButton() {
  const button = screen.getByRole("button", {
    name: i18n.t("settings.diagnostics.copy"),
  });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  return button;
}

afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

test.each([
  ["settings.open.state", "stateDirectory"],
  ["settings.open.logs", "logDirectory"],
  ["settings.open.config", "configDirectory"],
])("known_target_is_closed_enum: %s", async (label, target) => {
  let complete: () => void;
  const pending = new Promise<null>((resolve) => {
    complete = () => resolve(null);
  });
  const calls = mockAppIpc((command) =>
    command === "app_open_known_target" ? pending : undefined,
  );
  renderAbout();
  const button = await screen.findByRole("button", { name: i18n.t(label) });
  expect(button.textContent).toBe(i18n.t("settings.open.directory"));
  fireEvent.click(button);
  await waitFor(() => {
    expect(calls).toHaveBeenCalledWith("app_open_known_target", {
      input: { target },
    });
    expect(button).toHaveProperty("disabled", true);
  });
  expect(screen.queryByRole("link", { name: /支持|support/i })).toBeNull();
  await act(async () => complete());
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  expect(screen.getByText(about.stateRoot)).toBeTruthy();
  expect(
    calls.mock.calls.filter(([name]) => name === "app_about_get"),
  ).toHaveLength(1);
});

test.each([true, false])(
  "关于路径可选择、可折行且配置存在性用徽标表达：%s",
  async (exists) => {
    const stateRoot = "\\\\server\\share\\a very long directory\\state";
    const configFile = `${stateRoot}\\config.toml`;
    mockAppIpc((command) =>
      command === "app_about_get"
        ? {
            ...about,
            stateRoot,
            configFile,
            configFileExists: exists,
          }
        : undefined,
    );
    renderAbout();
    await screen.findByText(stateRoot);
    const terms = screen.getAllByRole("term");
    expect(terms.map((term) => term.textContent)).toEqual([
      "版本",
      "状态目录",
      "配置文件",
      "日志目录",
      "数据库类型",
      "数据库位置",
      "已执行迁移数",
      "缓存类型",
      "缓存位置",
      "缓存连通状态",
    ]);
    const row = screen.getByText("配置文件").parentElement;
    expect(row).not.toBeNull();
    const path = within(row as HTMLElement).getByText(configFile);
    expect(path.tagName).toBe("CODE");
    expect(path.textContent).toBe(configFile);
    expect(path.className).toContain("font-mono");
    expect(path.className).toContain("select-text");
    expect(path.querySelectorAll("wbr").length).toBeGreaterThan(1);
    expect(path.className).not.toContain("break-all");
    const badge = within(row as HTMLElement).getByText(
      i18n.t(exists ? "settings.configExists" : "settings.configMissing"),
    );
    expect(badge.getAttribute("data-slot")).toBe("badge");
    expect(badge.className).toContain("whitespace-nowrap");
    expect(
      within(row as HTMLElement).getByRole("button", {
        name: i18n.t("settings.open.config"),
      }).textContent,
    ).toBe("打开");
  },
);

test("open_failure_keeps_paths_and_reports_trace_without_reprobing", async () => {
  const failure = {
    code: "app.open.unavailable",
    params: {},
    traceId: "open-trace",
  };
  const calls = mockAppIpc((command) => {
    if (command === "app_open_known_target") return Promise.reject(failure);
    return undefined;
  });
  renderAbout();
  const button = await screen.findByRole("button", {
    name: i18n.t("settings.open.logs"),
  });
  fireEvent.click(button);
  const error = await screen.findByRole("alert");
  expect(error.textContent).toContain(i18n.t("errors.app.open.unavailable"));
  expect(error.textContent).toContain(failure.traceId);
  expect(screen.getByText(about.logDirectory)).toBeTruthy();
  expect(button).toHaveProperty("disabled", false);
  expect(
    calls.mock.calls.filter(([name]) => name === "app_about_get"),
  ).toHaveLength(1);
});

test("copy waits for clipboard success", async () => {
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let inClick = false;
  const writeText = vi.fn(() => {
    expect(inClick).toBe(true);
    return pending;
  });
  mockClipboard(writeText);
  mockAppIpc();
  renderAbout();
  const button = await readyCopyButton();
  inClick = true;
  fireEvent.click(button);
  inClick = false;
  expect(writeText).toHaveBeenCalledExactlyOnceWith(
    buildDiagnosticText(about, appModules, defaultSettings),
  );
  expect(screen.queryByText(i18n.t("settings.diagnostics.copied"))).toBeNull();
  expect(button).toHaveProperty("disabled", true);
  await act(async () => complete());
  expect(
    (await screen.findByText(i18n.t("settings.diagnostics.copied")))
      .textContent,
  ).toBe(i18n.t("settings.diagnostics.copied"));
  expect(screen.queryByRole("textbox")).toBeNull();
});

test.each(["reject", "missing", "throw"] as const)(
  "copy waits for clipboard success: %s shows the same text for manual copy",
  async (failure) => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const writeText = vi.fn(() => {
      if (failure === "throw") throw new Error("剪贴板不可用");
      return pending;
    });
    mockClipboard(failure === "missing" ? undefined : writeText);
    mockAppIpc();
    renderAbout();
    fireEvent.click(await readyCopyButton());
    if (failure === "reject") {
      expect(screen.queryByRole("textbox")).toBeNull();
      await act(async () => reject(new Error("剪贴板权限被拒绝")));
    }
    expect((await screen.findByRole("alert")).textContent).toBe(
      i18n.t("settings.diagnostics.copyFailed"),
    );
    const textbox = screen.getByRole("textbox", {
      name: i18n.t("settings.diagnostics.manualCopy"),
    });
    const text = buildDiagnosticText(about, appModules, defaultSettings);
    expect(textbox).toHaveProperty("readOnly", true);
    expect(textbox).toHaveProperty("value", text);
    if (failure === "missing") expect(writeText).not.toHaveBeenCalled();
    else expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(
      screen.queryByText(i18n.t("settings.diagnostics.copied")),
    ).toBeNull();
  },
);

test("about does not poll or refetch on focus", async () => {
  let version = about.version;
  const calls = mockAppIpc((command) =>
    command === "app_about_get" ? { ...about, version } : undefined,
  );
  const { client } = renderAbout();
  await readyCopyButton();
  const aboutCalls = () =>
    calls.mock.calls.filter(([name]) => name === "app_about_get");
  expect(aboutCalls()).toHaveLength(1);
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.blur(window);
    focusManager.setFocused(false);
    fireEvent.focus(window);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(aboutCalls()).toHaveLength(1);
  // Settings writes invalidate this query; that must not trigger a cache probe.
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["app", "about"] });
  });
  expect(aboutCalls()).toHaveLength(1);
  vi.useRealTimers();
  version = "refreshed-version";
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  await screen.findByText(version);
  expect(aboutCalls()).toHaveLength(2);
});

test.each(["app_about_get", "app_modules_list", "app_settings_get"])(
  "diagnostic copy waits for all inputs: %s",
  async (command) => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const values: Record<string, unknown> = {
      app_about_get: about,
      app_modules_list: appModules,
      app_settings_get: defaultSettings,
    };
    const calls = mockAppIpc((name) =>
      name === command ? pending.then(() => values[name]) : undefined,
    );
    renderAbout();
    await waitFor(() =>
      expect(calls.mock.calls.some(([name]) => name === command)).toBe(true),
    );
    const button = screen.getByRole("button", { name: "复制诊断信息" });
    expect(button).toHaveProperty("disabled", true);
    await act(async () => complete());
    await readyCopyButton();
  },
);

test("diagnostic copy reuses the shared modules query and rereads on entry", async () => {
  const calls = mockAppIpc();
  const { router } = renderApp("/settings/about");
  await screen.findByText(about.version);
  await readyCopyButton();
  expect(
    calls.mock.calls.filter(([name]) => name === "app_modules_list"),
  ).toHaveLength(1);
  await act(async () => {
    await router.navigate("/settings/general");
  });
  await screen.findByRole("heading", { name: "通用" });
  await act(async () => {
    await router.navigate("/settings/about");
  });
  await screen.findByText(about.version);
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([name]) => name === "app_about_get"),
    ).toHaveLength(2),
  );
  expect(
    calls.mock.calls.filter(([name]) => name === "app_modules_list"),
  ).toHaveLength(1);
});

test("export_does_not_probe_again and waits for the saved result", async () => {
  let select: (value: typeof diagnosticPick) => void;
  const selecting = new Promise<typeof diagnosticPick>((resolve) => {
    select = resolve;
  });
  let save: () => void;
  const exporting = new Promise<{ bytes: number; sha256: string }>(
    (resolve) => {
      save = () => resolve({ bytes: 1024, sha256: "a".repeat(64) });
    },
  );
  const calls = mockAppIpc((command) => {
    if (command === "app_file_pick") return selecting;
    if (command === "app_diagnostics_export") return exporting;
    return undefined;
  });
  renderAbout();
  const copy = await readyCopyButton();
  const button = screen.getByRole("button", {
    name: i18n.t("settings.diagnostics.export"),
  });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveProperty("disabled", true));
  expect(calls).toHaveBeenCalledWith("app_file_pick", {
    input: {
      purpose: "diagnosticsexport",
    },
  });
  expect(
    calls.mock.calls.some(([name]) => name === "app_diagnostics_export"),
  ).toBe(false);
  await act(async () => select(diagnosticPick));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_diagnostics_export", {
      input: { fileToken: diagnosticPick.token },
    }),
  );
  expect(button).toHaveProperty("disabled", true);
  expect(copy).toHaveProperty("disabled", false);
  expect(
    screen.queryByText(i18n.t("settings.diagnostics.exported")),
  ).toBeNull();
  expect(
    screen.getByText(i18n.t("settings.diagnostics.logsExcluded")),
  ).toBeTruthy();
  await act(async () => save());
  await screen.findByText(i18n.t("settings.diagnostics.exported"));
  expect(button).toHaveProperty("disabled", false);
  expect(
    calls.mock.calls.filter(([name]) => name === "app_about_get"),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("settings.diagnostics.refresh"),
    }),
  );
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([name]) => name === "app_about_get"),
    ).toHaveLength(2),
  );
});

test("cancelled_picker_returns_to_idle_without_export_or_error", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_file_pick" ? null : undefined,
  );
  renderAbout();
  await readyCopyButton();
  const button = screen.getByRole("button", {
    name: i18n.t("settings.diagnostics.export"),
  });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_file_pick", expect.anything()),
  );
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  expect(
    calls.mock.calls.some(([name]) => name === "app_diagnostics_export"),
  ).toBe(false);
  expect(
    calls.mock.calls.filter(([name]) => name === "app_about_get"),
  ).toHaveLength(1);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.queryByText(i18n.t("settings.diagnostics.exported")),
  ).toBeNull();
});

test.each([
  "app.diagnostics.needs_probe",
  "app.diagnostics.export_failed",
  "app.backup.storage_layout_unsupported",
])("export_failure_keeps_copy_fallback_without_reprobing: %s", async (code) => {
  const calls = mockAppIpc((command) => {
    if (command === "app_file_pick") return diagnosticPick;
    if (command === "app_diagnostics_export") {
      return Promise.reject({
        code,
        params: {},
        traceId: "diagnostic-trace",
      });
    }
    return undefined;
  });
  mockClipboard();
  renderAbout();
  const copy = await readyCopyButton();
  fireEvent.click(copy);
  const textbox = await screen.findByRole("textbox");
  const text = buildDiagnosticText(about, appModules, defaultSettings);
  const button = screen.getByRole("button", {
    name: i18n.t("settings.diagnostics.export"),
  });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await screen.findByText(i18n.t(`errors.${code}`));
  expect(textbox).toHaveProperty("value", text);
  expect(textbox).toHaveProperty("readOnly", true);
  expect(copy).toHaveProperty("disabled", false);
  expect(button).toHaveProperty("disabled", false);
  expect(
    screen.queryByText(i18n.t("settings.diagnostics.exported")),
  ).toBeNull();
  expect(
    calls.mock.calls.filter(([name]) => name === "app_about_get"),
  ).toHaveLength(1);
  if (code === "app.diagnostics.needs_probe") {
    expect(
      screen.getByText(i18n.t("settings.diagnostics.needsProbe")),
    ).toBeTruthy();
  }
});

test("locked_session_can_copy_but_cannot_export", async () => {
  const calls = mockAppIpc((command) =>
    command === "account_auth_status"
      ? {
          mode: "login",
          state: "locked",
          user: { ...currentUser, mode: "login" },
          permissions: [],
          idleLockMinutes: 15,
        }
      : undefined,
  );
  renderAbout();
  await readyCopyButton();
  expect(
    screen.getByRole("button", { name: i18n.t("settings.diagnostics.export") }),
  ).toHaveProperty("disabled", true);
  expect(calls.mock.calls.some(([name]) => name === "app_file_pick")).toBe(
    false,
  );
});

test("picker_failure_keeps_copy_available", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_file_pick"
      ? Promise.reject({
          code: "app.internal.unexpected",
          params: {},
          traceId: "picker-trace",
        })
      : undefined,
  );
  renderAbout();
  const copy = await readyCopyButton();
  const button = screen.getByRole("button", {
    name: i18n.t("settings.diagnostics.export"),
  });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await screen.findByRole("alert");
  expect(copy).toHaveProperty("disabled", false);
  expect(
    calls.mock.calls.some(([name]) => name === "app_diagnostics_export"),
  ).toBe(false);
});
