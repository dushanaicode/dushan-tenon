import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { PageTitleFocusProvider, toast } from "@/kit";
import {
  CommandPalette,
  CommandPaletteProvider,
  CommandPaletteTrigger,
  useCommandPalette,
} from "./command-palette";
import type { ShellCommand } from "./commands";
import { ShellFocusProvider } from "./shell-focus";
import "./shell.test-support";

const command: ShellCommand = {
  id: "go",
  label: "执行测试",
  keywords: ["测试"],
  group: "actions",
  shortcut: "$mod+j",
  run: vi.fn(),
};
it("Ctrl+K 可在编辑区开关，Esc 返回 ref 触发器；选择执行命令", async () => {
  render(
    <PageTitleFocusProvider>
      <ShellFocusProvider>
        <CommandPaletteProvider commands={[command]}>
          <CommandPaletteTrigger />
          <CommandPalette />
        </CommandPaletteProvider>
      </ShellFocusProvider>
    </PageTitleFocusProvider>,
  );
  const trigger = screen.getByRole("button");
  trigger.focus();
  fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
  const input = await screen.findByRole("combobox");
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger);
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("option", {
      name: /执行测试/,
    }),
  );
  expect(command.run).toHaveBeenCalledOnce();
});
it("旧执行引用读取最新目录；被移除和禁用命令不执行", async () => {
  const old = vi.fn();
  const next = vi.fn();
  let commands = [{ ...command, run: old }];
  const view = renderHook(useCommandPalette, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <CommandPaletteProvider commands={commands}>
        {children}
      </CommandPaletteProvider>
    ),
  });
  const run = view.result.current.runCommand;
  commands = [{ ...command, run: next }];
  view.rerender();
  await act(() => run("go"));
  expect(old).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledOnce();
  commands = [];
  view.rerender();
  const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  await act(() => run("go"));
  expect(error).toHaveBeenCalled();
  expect(next).toHaveBeenCalledOnce();
});
it("冲突快捷键不绑定；键位查询未成功时没有前台绑定", () => {
  const run = vi.fn();
  const view = renderHook(useCommandPalette, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <CommandPaletteProvider
        shortcutsReady={false}
        commands={[{ ...command, run }]}
      >
        {children}
      </CommandPaletteProvider>
    ),
  });
  fireEvent.keyDown(window, { key: "j", code: "KeyJ", ctrlKey: true });
  expect(run).not.toHaveBeenCalled();
  expect(view.result.current.paletteShortcut).toBeUndefined();
});
