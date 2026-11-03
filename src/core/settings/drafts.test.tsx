import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import {
  currentUser,
  mockAppIpc,
  paramEntries,
} from "@/core/core.test-support";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { renderSettings } from "./settings.test-support";

const path = "/settings/param.account.security";
const label = "空闲自动锁定（分钟）";

async function edit(value = "22") {
  fireEvent.change(await screen.findByRole("textbox", { name: label }), {
    target: { value },
  });
}

test("one blocker retains parameter drafts across sections and confirms leaving", async () => {
  const calls = mockAppIpc();
  const { router } = renderSettings(path);
  await edit();
  await act(() => router.navigate("/settings/general"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(() => router.navigate(path));
  expect(await screen.findByRole("textbox", { name: label })).toHaveProperty(
    "value",
    "22",
  );
  await act(() => router.navigate("/"));
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "继续编辑",
    }),
  );
  expect(screen.getByRole("textbox", { name: label })).toHaveProperty(
    "value",
    "22",
  );
  await act(() => router.navigate("/"));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "放弃修改",
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  await act(() => router.navigate(path));
  expect(await screen.findByRole("textbox", { name: label })).toHaveProperty(
    "value",
    "15",
  );
  expect(calls.mock.calls.some(([name]) => name === "app_setting_set")).toBe(
    false,
  );
});

test("settings retain drafts until explicit discard: save finishes after switching section", async () => {
  let finish!: (entry: ParamEntry) => void;
  const pending = new Promise<ParamEntry>((resolve) => {
    finish = resolve;
  });
  const entry = { ...paramEntries[0] };
  mockAppIpc((command) => {
    if (command === "app_setting_list") return [{ ...entry }];
    if (command === "app_setting_set") return pending;
  });
  const { router } = renderSettings(path);
  await edit();
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText("正在保存…");
  fireEvent.click(screen.getByRole("link", { name: "通用" }));
  await screen.findByRole("region", { name: "通用" });
  entry.value = "22";
  entry.rowVersion = 1;
  await act(async () => finish({ ...entry }));
  await act(async () => {
    await router.navigate("/");
  });
  expect(router.state.location.pathname).toBe("/");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(async () => {
    await router.navigate(path);
  });
  expect(await screen.findByRole("textbox", { name: label })).toHaveProperty(
    "value",
    "22",
  );
});

test("settings retain drafts until explicit discard: preserve base version after refresh", async () => {
  const calls = mockAppIpc((command) => {
    if (command === "app_setting_set")
      throw {
        code: "app.data.version_conflict",
        params: {},
        traceId: "draft-conflict",
      };
  });
  const { client, router } = renderSettings(path);
  await edit();
  await act(async () => {
    client.setQueryData(
      ["app", "setting", currentUser.id, false],
      [{ ...paramEntries[0], value: "35", rowVersion: 7 }],
    );
    await router.navigate("/settings/general");
  });
  await screen.findByRole("region", { name: "通用" });
  await act(async () => {
    await router.navigate(path);
  });
  expect(await screen.findByRole("textbox", { name: label })).toHaveProperty(
    "value",
    "22",
  );
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText(/草稿和编辑起点版本已保留/);
  expect(calls).toHaveBeenCalledWith("app_setting_set", {
    input: {
      key: paramEntries[0].key,
      value: "22",
      rowVersion: null,
    },
  });
});

test("settings retain drafts until explicit discard: secrets stay local", async () => {
  mockAppIpc((command) =>
    command === "app_setting_list"
      ? [
          {
            ...paramEntries[0],
            kind: { type: "secret" },
            value: null,
            default: null,
          },
        ]
      : undefined,
  );
  const { router, client } = renderSettings(path);
  const form = within(await screen.findByRole("form", { name: label }));
  fireEvent.change(form.getByLabelText(label), {
    target: { value: "local-only-secret" },
  });
  expect(
    JSON.stringify(
      client.getQueryData(["app", "setting", currentUser.id, false]),
    ),
  ).not.toContain("local-only-secret");
  fireEvent.click(screen.getByRole("link", { name: "通用" }));
  await screen.findByRole("region", { name: "通用" });
  await act(async () => {
    await router.navigate(path);
  });
  const restored = within(await screen.findByRole("form", { name: label }));
  expect(restored.getByLabelText(label)).toHaveProperty("value", "");
  await act(async () => {
    await router.navigate("/");
  });
  expect(router.state.location.pathname).toBe("/");
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test.each([
  ["", ""],
  ["1.", "1"],
  ["abc", ""],
])(
  "settings retain drafts until explicit discard: incomplete integer %s",
  async (value, restored) => {
    const entry = { ...paramEntries[0], rowVersion: 7 };
    const calls = mockAppIpc((command) => {
      if (command === "app_setting_list") return [{ ...entry }];
      if (command === "app_setting_set") {
        throw {
          code: "app.data.version_conflict",
          params: {},
          traceId: "normalized-draft-version",
        };
      }
    });
    const { router } = renderSettings(path);
    await edit(value);
    await act(async () => {
      await router.navigate("/settings/general");
    });
    await screen.findByRole("region", { name: "通用" });
    entry.rowVersion = 8;
    await act(async () => {
      await router.navigate(path);
    });
    expect(await screen.findByRole("textbox", { name: label })).toHaveProperty(
      "value",
      restored,
    );
    const form = screen.getByRole("form", { name: label });
    const row = within(form);
    expect(row.getByRole("textbox")).not.toHaveProperty("value", "NaN");
    if (restored === "") {
      expect(screen.getByRole("button", { name: "应用" })).toHaveProperty(
        "disabled",
        true,
      );
      expect(row.getByText("请输入符合说明和范围的有效值。")).toBeTruthy();
      fireEvent.submit(form);
      expect(
        calls.mock.calls.some(([name]) => name === "app_setting_set"),
      ).toBe(false);
      await edit("22");
    }
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await row.findByText(/草稿和编辑起点版本已保留/);
    expect(calls).toHaveBeenCalledWith("app_setting_set", {
      input: {
        key: entry.key,
        value: restored === "" ? "22" : restored,
        rowVersion: 7,
      },
    });
  },
);

test.each(["link", "navigate", "back", "forward"] as const)(
  "settings retain drafts until explicit discard: %s",
  async (method) => {
    mockAppIpc();
    const { router } = renderSettings("/");
    await screen.findByRole("navigation", { name: "主导航" });
    await act(async () => {
      await router.navigate(path);
    });
    if (method === "forward") {
      await act(async () => {
        await router.navigate("/");
      });
      await act(async () => {
        await router.navigate(-1);
      });
    }
    await edit();
    async function leave() {
      if (method === "back" || method === "forward") {
        await act(async () => {
          await router.navigate(method === "back" ? -1 : 1);
        });
      } else if (method === "navigate") {
        await act(() => router.navigate("/"));
      } else {
        fireEvent.click(screen.getByRole("link", { name: "首页" }));
      }
    }
    await leave();
    let dialog = within(await screen.findByRole("alertdialog"));
    expect(router.state.location.pathname).toBe(path);
    fireEvent.click(dialog.getByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("textbox", { name: label })).toHaveProperty(
      "value",
      "22",
    );
    await leave();
    dialog = within(await screen.findByRole("alertdialog"));
    fireEvent.click(dialog.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await act(async () => {
      await router.navigate(path);
    });
    expect(await screen.findByRole("textbox", { name: label })).toHaveProperty(
      "value",
      "15",
    );
  },
);

test.each(["locked", "anonymous", "user"] as const)(
  "settings retain drafts until explicit discard: clear on %s",
  async (change) => {
    mockAppIpc();
    const { client, router } = renderSettings(path);
    await edit();
    const original = client.getQueryData<AuthStatus>(authKey);
    if (!original) throw new Error("认证状态尚未载入");
    const changed: AuthStatus =
      change === "user"
        ? {
            ...original,
            user: { ...currentUser, id: "another-user" },
          }
        : {
            ...original,
            mode: "login",
            state: change,
            user: change === "anonymous" ? null : currentUser,
          };
    await act(async () => {
      client.setQueryData(authKey, changed);
    });
    if (change !== "user") {
      await screen.findByRole("heading", {
        name: change === "locked" ? "已锁定" : "登录",
      });
      expect(screen.queryByRole("textbox", { name: label })).toBeNull();
    } else {
      await waitFor(() =>
        expect(
          client.getQueryData(["app", "setting", "another-user", false]),
        ).toBeTruthy(),
      );
      expect(
        await screen.findByRole("textbox", { name: label }),
      ).toHaveProperty("value", "15");
    }
    await act(async () => {
      client.setQueryData(authKey, original);
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: label })).toHaveProperty(
        "value",
        "15",
      ),
    );
    await act(async () => {
      await router.navigate("/");
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  },
);
