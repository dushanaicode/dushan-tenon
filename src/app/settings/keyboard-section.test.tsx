import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it } from "vitest";
import type { KeyboardSettings } from "@/lib/generated/KeyboardSettings";
import type { KeyboardUpdate } from "@/lib/generated/KeyboardUpdate";
import { CommandPaletteProvider } from "@/shell/command-palette";
import { KeyboardSection } from "./keyboard-section";
import { mockAppIpc, renderApp, renderSetting } from "./settings.test-support";

function keyboardFixture(failFirst = false) {
  let settings: KeyboardSettings = {
    canEdit: true,
    snapshot: { schemaVersion: 1, revision: 0, bindings: [] },
  };
  let fails = failFirst;
  const calls = mockAppIpc((name, payload) => {
    if (name === "app_keyboard_get") return structuredClone(settings);
    if (name === "app_keyboard_update") {
      if (fails) {
        fails = false;
        throw {
          code: "app.keyboard.write_failed",
          params: {},
          traceId: "keyboard-test",
        };
      }
      const { input } = payload as { input: KeyboardUpdate };
      settings = {
        canEdit: true,
        snapshot: {
          schemaVersion: 1,
          revision: settings.snapshot.revision + 1,
          bindings: input.bindings,
        },
      };
      return structuredClone(settings);
    }
  });
  return { calls, read: () => settings };
}

it("录制与其他命令冲突时显示命令并阻止保存", async () => {
  const f = keyboardFixture();
  renderSetting(
    <CommandPaletteProvider
      commands={[
        {
          id: "test.action",
          label: "测试动作",
          group: "actions",
          keywords: [],
          shortcut: "$mod+Shift+KeyK",
          run: () => {},
        },
      ]}
    >
      <KeyboardSection />
    </CommandPaletteProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "录制" }));
  fireEvent.keyDown(screen.getByLabelText("新按键"), {
    key: "K",
    code: "KeyK",
    ctrlKey: true,
    shiftKey: true,
  });
  expect((await screen.findByRole("alert")).textContent).toContain("测试动作");
  expect(screen.getByRole("button", { name: "保存快捷键" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    f.calls.mock.calls.some(([name]) => name === "app_keyboard_update"),
  ).toBe(false);
});

async function record() {
  fireEvent.click(await screen.findByRole("button", { name: "录制" }));
  const input = screen.getByLabelText("新按键");
  fireEvent.keyDown(input, {
    key: "K",
    code: "KeyK",
    ctrlKey: true,
    shiftKey: true,
    isComposing: true,
  });
  expect((input as HTMLInputElement).value).toBe("");
  fireEvent.keyDown(input, {
    key: "K",
    code: "KeyK",
    ctrlKey: true,
    shiftKey: true,
  });
  return input;
}

it("录制不会触发命令；保存成功后才改变快捷键，禁用与恢复默认共享当前事实", async () => {
  const f = keyboardFixture();
  renderApp("/settings/general");
  const input = await record();
  expect(screen.queryByRole("dialog", { name: "命令面板" })).toBeNull();
  expect((input as HTMLInputElement).value).toBe("Ctrl Shift K");
  const trigger = screen.getByRole("button", { name: "搜索命令" });
  expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K");
  fireEvent.click(
    within(screen.getByRole("group", { name: "应用内快捷键" })).getByRole(
      "button",
      { name: "保存快捷键" },
    ),
  );
  await waitFor(() =>
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe(
      "Control+Shift+K Meta+Shift+K",
    ),
  );
  expect(f.read().snapshot.bindings).toEqual([
    { commandId: "app.palette", keys: "$mod+Shift+KeyK" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "禁用此快捷键" }));
  await waitFor(() =>
    expect(trigger.hasAttribute("aria-keyshortcuts")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "恢复此命令默认" }));
  await waitFor(() =>
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K"),
  );
  expect(f.read().snapshot.bindings).toEqual([]);
});

it("保存失败保留录制值与旧绑定，重试成功后才生效", async () => {
  const f = keyboardFixture(true);
  renderApp("/settings/general");
  const input = await record();
  fireEvent.click(
    within(screen.getByRole("group", { name: "应用内快捷键" })).getByRole(
      "button",
      { name: "保存快捷键" },
    ),
  );
  await screen.findByText("快捷键未保存，请重试。");
  expect(f.read().snapshot.bindings).toEqual([]);
  expect((input as HTMLInputElement).value).toBe("Ctrl Shift K");
  expect(
    screen
      .getByRole("button", { name: "搜索命令" })
      .getAttribute("aria-keyshortcuts"),
  ).toBe("Control+K Meta+K");
  fireEvent.click(
    within(screen.getByRole("group", { name: "应用内快捷键" })).getByRole(
      "button",
      { name: "保存快捷键" },
    ),
  );
  await screen.findByText("快捷键已保存并生效");
  expect(f.read().snapshot.bindings).toHaveLength(1);
});

it("读取失败不注册默认快捷键", async () => {
  mockAppIpc((name) => {
    if (name === "app_keyboard_get")
      throw {
        code: "app.keyboard.read_failed",
        params: {},
        traceId: "keyboard-read",
      };
  });
  renderApp("/settings/general");
  await screen.findByText("无法读取快捷键设置。");
  act(() =>
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true }),
  );
  expect(screen.queryByRole("dialog", { name: "命令面板" })).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "搜索命令" })
      .hasAttribute("aria-keyshortcuts"),
  ).toBe(false);
});

it("非owner投影只读，不能录制或修改按键", async () => {
  mockAppIpc((name) => {
    if (name === "app_keyboard_get")
      return {
        canEdit: false,
        snapshot: { schemaVersion: 1, revision: 0, bindings: [] },
      };
  });
  renderApp("/settings/general");
  const record = await screen.findByRole("button", {
    name: "录制",
  });
  expect((record as HTMLButtonElement).disabled).toBe(true);
  expect(
    (screen.getByRole("button", { name: "禁用此快捷键" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
