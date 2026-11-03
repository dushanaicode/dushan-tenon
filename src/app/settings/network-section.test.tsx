import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import type { NetworkSettings } from "@/lib/generated/NetworkSettings";
import {
  currentUser,
  defaultNetworkSettings,
  mockAppIpc,
  renderApp,
} from "./settings.test-support";

const manualSettings: NetworkSettings = {
  ...defaultNetworkSettings,
  mode: { value: "manual", source: "file" },
  endpoint: { value: "https://proxy.example:443", source: "file" },
  auth: { value: false, source: "file" },
};

test.each([false, true])(
  "disabling_proxy_auth_saves_keep_without_hidden_draft: saved credentials %s",
  async (credentialsSet) => {
    const saved: NetworkSettings = {
      ...manualSettings,
      credentialsSet,
      credentialSource: credentialsSet ? "credentialStore" : "none",
    };
    const calls = mockAppIpc((command) =>
      command === "app_network_settings_get" ||
      command === "app_network_settings_update"
        ? saved
        : undefined,
    );
    renderApp("/settings/network");
    const auth = await screen.findByRole("switch", { name: "代理认证" });
    fireEvent.click(auth);
    fireEvent.change(screen.getByLabelText("代理用户名"), {
      target: { value: "alice" },
    });
    fireEvent.click(auth);
    expect(screen.queryByLabelText("代理用户名")).toBeNull();
    expect(screen.queryByLabelText("代理密码")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
    await waitFor(() => expect(auth).toHaveProperty("disabled", false));
    expect(calls).toHaveBeenCalledWith("app_network_settings_update", {
      input: {
        mode: "manual",
        endpoint: manualSettings.endpoint.value,
        auth: false,
        credentials: { type: "keep" },
      },
    });
    fireEvent.click(auth);
    expect(screen.getByLabelText("代理用户名")).toHaveProperty("value", "");
    expect(screen.getByLabelText("代理密码")).toHaveProperty("value", "");
  },
);

test("disabling_proxy_auth_clears_both_drafts_before_save", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_network_settings_get" ? manualSettings : undefined,
  );
  renderApp("/settings/network");
  const auth = await screen.findByRole("switch", { name: "代理认证" });
  fireEvent.click(auth);
  fireEvent.change(screen.getByLabelText("代理用户名"), {
    target: { value: "alice" },
  });
  fireEvent.change(screen.getByLabelText("代理密码"), {
    target: { value: "draft-password" },
  });
  fireEvent.click(auth);
  fireEvent.click(auth);
  expect(screen.getByLabelText("代理用户名")).toHaveProperty("value", "");
  expect(screen.getByLabelText("代理密码")).toHaveProperty("value", "");
  expect(
    calls.mock.calls.some(
      ([command]) => command === "app_network_settings_update",
    ),
  ).toBe(false);
});

test("enabled_proxy_auth_saves_replacement_credentials", async () => {
  const calls = mockAppIpc((command) =>
    command === "app_network_settings_get" ? manualSettings : undefined,
  );
  renderApp("/settings/network");
  fireEvent.click(await screen.findByRole("switch", { name: "代理认证" }));
  fireEvent.change(screen.getByLabelText("代理用户名"), {
    target: { value: "alice" },
  });
  fireEvent.change(screen.getByLabelText("代理密码"), {
    target: { value: "replacement-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_network_settings_update", {
      input: {
        mode: "manual",
        endpoint: manualSettings.endpoint.value,
        auth: true,
        credentials: {
          type: "replace",
          username: "alice",
          password: "replacement-password",
        },
      },
    }),
  );
});

test("network_form_uses_saved_values", async () => {
  const calls = mockAppIpc();
  const { client, router } = renderApp("/settings/network");
  const mode = await screen.findByRole("combobox", { name: "代理模式" });
  expect(
    screen.getByText(/数据库、Redis 和 WebView 不使用此代理/),
  ).toBeTruthy();
  fireEvent.click(mode);
  fireEvent.click(screen.getByRole("option", { name: "显式代理" }));
  fireEvent.change(screen.getByRole("textbox", { name: "代理地址" }), {
    target: { value: "https://proxy.example:443" },
  });
  fireEvent.click(screen.getByRole("switch", { name: "代理认证" }));
  fireEvent.change(screen.getByLabelText("代理用户名"), {
    target: { value: "username-sentinel" },
  });
  fireEvent.change(screen.getByLabelText("代理密码"), {
    target: { value: "password-sentinel" },
  });
  expect(
    calls.mock.calls.some(
      ([command]) => command === "app_network_settings_update",
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
  await screen.findByText("代理凭据已设置");
  expect(screen.getByLabelText("代理用户名")).toHaveProperty("value", "");
  expect(screen.getByLabelText("代理密码")).toHaveProperty("value", "");
  expect(calls).toHaveBeenCalledWith("app_network_settings_update", {
    input: {
      mode: "manual",
      endpoint: "https://proxy.example:443",
      auth: true,
      credentials: {
        type: "replace",
        username: "username-sentinel",
        password: "password-sentinel",
      },
    },
  });
  for (const cache of [
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.state),
    client
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
  ]) {
    expect(JSON.stringify(cache)).not.toContain("username-sentinel");
    expect(JSON.stringify(cache)).not.toContain("password-sentinel");
  }
  fireEvent.change(screen.getByLabelText("代理密码"), {
    target: { value: "unsaved-secret" },
  });
  await act(async () => {
    await router.navigate("/settings/general");
  });
  expect(screen.queryByLabelText("代理密码")).toBeNull();
  await act(async () => {
    await router.navigate("/settings/network");
  });
  expect(await screen.findByLabelText("代理密码")).toHaveProperty("value", "");
  fireEvent.click(screen.getByRole("combobox", { name: "代理模式" }));
  fireEvent.click(screen.getByRole("option", { name: "直接连接" }));
  fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
  await waitFor(() =>
    expect(calls).toHaveBeenLastCalledWith("app_network_settings_update", {
      input: {
        mode: "direct",
        endpoint: "https://proxy.example:443",
        auth: true,
        credentials: { type: "keep" },
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "清除代理认证" }));
  await screen.findByText("代理凭据未设置");
});

test.each(["environment", "commandLine", "secret"] as const)(
  "network_group_is_read_only: %s",
  async (source) => {
    const saved: NetworkSettings = {
      ...defaultNetworkSettings,
      mode: { value: "manual", source: "file" },
      endpoint: {
        value: "https://saved.example:443",
        source: source === "secret" ? "file" : source,
      },
      credentialSource: source === "secret" ? "environment" : "none",
    };
    const calls = mockAppIpc((command) =>
      command === "app_network_settings_get" ? saved : undefined,
    );
    renderApp("/settings/network");
    expect(
      await screen.findByRole("textbox", { name: "代理地址" }),
    ).toHaveProperty("value", "https://saved.example:443");
    expect(screen.getByRole("button", { name: "保存代理设置" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("combobox", { name: "代理模式" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      calls.mock.calls.some(
        ([command]) => command === "app_network_settings_update",
      ),
    ).toBe(false);
  },
);

test("network_failure_refreshes_facts_and_disables_duplicate_save", async () => {
  let rejectSave: (error: unknown) => void = () => {
    throw new Error("save not started");
  };
  const pending = new Promise<NetworkSettings>((_, reject) => {
    rejectSave = reject;
  });
  const calls = mockAppIpc((command) =>
    command === "app_network_settings_update" ? pending : undefined,
  );
  renderApp("/settings/network");
  const save = await screen.findByRole("button", { name: "保存代理设置" });
  fireEvent.click(save);
  expect(save).toHaveProperty("disabled", true);
  await act(async () =>
    rejectSave({
      code: "app.network.compensation_failed",
      params: {},
      traceId: "network-save-trace",
    }),
  );
  await screen.findByText(/network-save-trace/);
  expect(
    calls.mock.calls.filter(
      ([command]) => command === "app_network_settings_get",
    ),
  ).toHaveLength(2);
  expect(screen.queryByText(/已保存；下一次请求生效/)).toBeNull();
});

test.each(["none", "login"] as const)(
  "network_active_owner_without_module_permissions: %s",
  async (mode) => {
    const calls = mockAppIpc((command) =>
      command === "account_auth_status"
        ? {
            mode,
            state: "active",
            user: { ...currentUser, mode },
            permissions: [],
            idleLockMinutes: 15,
          }
        : undefined,
    );
    renderApp("/settings/network");
    await screen.findByRole("combobox", { name: "代理模式" });
    expect(
      calls.mock.calls.some(
        ([command]) => command === "app_network_settings_get",
      ),
    ).toBe(true);
  },
);
