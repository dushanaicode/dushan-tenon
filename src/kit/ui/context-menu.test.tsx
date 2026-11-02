import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { Button } from "./button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";

function Example({
  disabled = false,
  select = () => {},
}: {
  disabled?: boolean;
  select?: () => void;
}) {
  const [checked, setChecked] = useState(true);
  const [value, setValue] = useState("one");
  return (
    <>
      <Button>外部</Button>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={disabled}>
          <Button>上下文菜单</Button>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label="动作" className="w-64">
          <ContextMenuGroup>
            <ContextMenuLabel>Actions</ContextMenuLabel>
            <ContextMenuItem onSelect={select}>
              Alpha<ContextMenuShortcut>Ctrl A</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled onSelect={select}>
              Disabled
            </ContextMenuItem>
            <ContextMenuItem>Beta</ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Export</ContextMenuSubTrigger>
            <ContextMenuSubContent aria-label="导出">
              <ContextMenuItem>Text</ContextMenuItem>
              <ContextMenuItem disabled>Unavailable</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem
            checked={checked}
            onCheckedChange={(next) => setChecked(next === true)}
            onSelect={(event) => event.preventDefault()}
          >
            显示预览
          </ContextMenuCheckboxItem>
          <ContextMenuRadioGroup value={value} onValueChange={setValue}>
            <ContextMenuRadioItem
              value="one"
              onSelect={(event) => event.preventDefault()}
            >
              选项一
            </ContextMenuRadioItem>
            <ContextMenuRadioItem
              value="two"
              onSelect={(event) => event.preventDefault()}
            >
              选项二
            </ContextMenuRadioItem>
          </ContextMenuRadioGroup>
          <ContextMenuItem>中文长标题没有被截断仍然完整可读</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}
async function open() {
  const trigger = screen.getByRole("button", { name: "上下文菜单" });
  act(() => trigger.focus());
  fireEvent.contextMenu(trigger, { clientX: 100, clientY: 100 });
  return screen.findByRole("menu", { name: "动作" });
}
it("右键 / 原生键盘 contextmenu 入口、方向键 / Home / End / 首字母、禁用与 Esc 回焦点", async () => {
  const selected = vi.fn();
  const { container } = render(<Example select={selected} />);
  const menu = await open();
  expect(menu.dataset).toMatchObject({
    slot: "context-menu-content",
    kit: "context-menu",
  });
  expect(container.contains(menu)).toBe(false);
  const alpha = screen.getByRole("menuitem", { name: "Alpha Ctrl A" });
  act(() => alpha.focus());
  fireEvent.keyDown(alpha, { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Beta" }),
    ),
  );
  fireEvent.keyDown(menu, { key: "End" });
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain("中文长标题"),
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  await waitFor(() => expect(document.activeElement).toBe(alpha));
  fireEvent.keyDown(alpha, { key: "b" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Beta" }),
    ),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Disabled" }));
  expect(selected).not.toHaveBeenCalled();
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "上下文菜单" }),
  );
  // 浏览器将 Shift+F10 / 菜单键转为 contextmenu；DOM 模型不执行此原生默认动作。
  fireEvent.keyDown(document.activeElement as Element, {
    key: "F10",
    shiftKey: true,
  });
  fireEvent.contextMenu(document.activeElement as Element);
  expect(await screen.findByRole("menu", { name: "动作" })).toBeTruthy();
});
it("子菜单 → / ←，勾选和单选值，外点关闭", async () => {
  render(<Example />);
  const menu = await open();
  const sub = screen.getByRole("menuitem", { name: "Export" });
  act(() => sub.focus());
  fireEvent.keyDown(sub, { key: "ArrowRight" });
  const text = await screen.findByRole("menuitem", { name: "Text" });
  await waitFor(() => expect(document.activeElement).toBe(text));
  const panel = screen.getByRole("menu", { name: "Export" });
  expect(panel.dataset.slot).toBe("context-menu-sub-content");
  expect(sub.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(text, { key: "ArrowLeft" });
  await waitFor(() =>
    expect(screen.queryByRole("menu", { name: "Export" })).toBeNull(),
  );
  expect(document.activeElement).toBe(sub);
  const check = screen.getByRole("menuitemcheckbox", { name: "显示预览" });
  expect(check.getAttribute("aria-checked")).toBe("true");
  expect(
    check.querySelector('[data-slot="context-menu-item-indicator"] svg'),
  ).not.toBeNull();
  act(() => check.focus());
  fireEvent.keyDown(check, { key: " " });
  expect(check.getAttribute("aria-checked")).toBe("false");
  const radio = screen.getByRole("menuitemradio", { name: "选项二" });
  fireEvent.click(radio);
  expect(radio.getAttribute("aria-checked")).toBe("true");
  expect(
    screen
      .getByRole("menuitemradio", { name: "选项一" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  expect(screen.getByText("Ctrl A").dataset.slot).toBe("context-menu-shortcut");
  expect(screen.getByText("Actions").dataset.slot).toBe("context-menu-label");
  expect(screen.getByRole("separator").dataset.slot).toBe(
    "context-menu-separator",
  );
  expect(menu.className).toContain(
    "max-w-(--radix-context-menu-content-available-width)",
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "外部", hidden: true }),
    { button: 0, pointerType: "mouse" },
  );
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
it("禁用入口不打开；Enter 选择动作关闭", async () => {
  const selected = vi.fn();
  const { rerender } = render(<Example disabled select={selected} />);
  fireEvent.contextMenu(screen.getByRole("button", { name: "上下文菜单" }));
  expect(screen.queryByRole("menu")).toBeNull();
  rerender(<Example select={selected} />);
  await open();
  const item = screen.getByRole("menuitem", { name: "Alpha Ctrl A" });
  act(() => item.focus());
  fireEvent.keyDown(item, { key: "Enter" });
  expect(selected).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
