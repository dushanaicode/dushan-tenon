import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  type MenubarContentProps,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "./menubar";

type CapturedContent = MenubarContentProps & {
  "data-menubar-instance"?: string;
};
const captured = vi.hoisted(() => new Map<string, CapturedContent>());
vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>();
  return {
    ...actual,
    Menubar: {
      ...actual.Menubar,
      Content: (props: CapturedContent) => {
        captured.set(props["aria-label"] as string, props);
        return <actual.Menubar.Content {...props} />;
      },
    },
  };
});
beforeEach(() => captured.clear());
function content(name: string) {
  const value = captured.get(name);
  expect(value, name).toBeDefined();
  return value as CapturedContent;
}

function Example() {
  const [checked, setChecked] = useState(true);
  const [value, setValue] = useState("a");
  return (
    <>
      <button type="button">外部</button>
      <Menubar aria-label="编辑器">
        <MenubarMenu value="file">
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent aria-label="File">
            <MenubarGroup>
              <MenubarLabel>Workspace</MenubarLabel>
              <MenubarItem>
                Alpha<MenubarShortcut>Ctrl A</MenubarShortcut>
              </MenubarItem>
              <MenubarItem disabled>Disabled</MenubarItem>
              <MenubarItem>Beta</MenubarItem>
            </MenubarGroup>
            <MenubarSub>
              <MenubarSubTrigger>Export</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem>Text</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarCheckboxItem
              checked={checked}
              onCheckedChange={(next) => setChecked(next === true)}
              onSelect={(event) => event.preventDefault()}
            >
              预览
            </MenubarCheckboxItem>
            <MenubarRadioGroup value={value} onValueChange={setValue}>
              <MenubarRadioItem
                value="a"
                onSelect={(event) => event.preventDefault()}
              >
                甲
              </MenubarRadioItem>
              <MenubarRadioItem
                value="b"
                onSelect={(event) => event.preventDefault()}
              >
                乙
              </MenubarRadioItem>
            </MenubarRadioGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu value="disabled">
          <MenubarTrigger disabled>Disabled menu</MenubarTrigger>
          <MenubarContent aria-label="Disabled menu">
            <MenubarItem>不可用</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu value="edit">
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent aria-label="Edit">
            <MenubarItem>Undo</MenubarItem>
            <MenubarItem>Copy</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </>
  );
}
it("关闭态左右只移焦点且跳过禁用；展开态左右切组并保持打开；Esc 回触发器", async () => {
  const { container } = render(<Example />);
  const bar = screen.getByRole("menubar", { name: "编辑器" });
  expect(bar.dataset).toMatchObject({ slot: "menubar", kit: "menubar" });
  const file = within(bar).getByRole("menuitem", { name: "File" });
  const edit = within(bar).getByRole("menuitem", { name: "Edit" });
  act(() => file.focus());
  fireEvent.keyDown(file, { key: "ArrowRight" });
  await waitFor(() => expect(document.activeElement).toBe(edit));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.keyDown(edit, { key: "ArrowLeft" });
  await waitFor(() => expect(document.activeElement).toBe(file));
  fireEvent.keyDown(file, { key: "Enter" });
  const menu = await screen.findByRole("menu", { name: "File" });
  expect(container.contains(menu)).toBe(false);
  expect(menu.dataset.kit).toBe("menubar");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Alpha Ctrl A" }),
    ),
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
  const editMenu = await screen.findByRole("menu", { name: "Edit" });
  await waitFor(() => expect(document.activeElement).toBe(editMenu));
  fireEvent.keyDown(editMenu, { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Undo" }),
    ),
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
  await screen.findByRole("menu", { name: "File" });
  fireEvent.keyDown(screen.getByRole("menu", { name: "File" }), {
    key: "Escape",
  });
  await waitFor(() => expect(document.activeElement).toBe(file));
  expect(screen.queryByRole("menu")).toBeNull();
});
it("上下 / Home / End / 首字母、子菜单 → ←，勾选 / 单选与外点关闭", async () => {
  render(<Example />);
  const file = screen.getByRole("menuitem", { name: "File" });
  act(() => file.focus());
  fireEvent.keyDown(file, { key: "ArrowDown" });
  const menu = await screen.findByRole("menu", { name: "File" });
  const alpha = screen.getByRole("menuitem", { name: "Alpha Ctrl A" });
  act(() => alpha.focus());
  fireEvent.keyDown(alpha, { key: "ArrowDown" });
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Beta"));
  fireEvent.keyDown(document.activeElement as Element, { key: "End" });
  await waitFor(() => expect(document.activeElement?.textContent).toBe("乙"));
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  await waitFor(() => expect(document.activeElement).toBe(alpha));
  fireEvent.keyDown(alpha, { key: "b" });
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Beta"));
  const sub = screen.getByRole("menuitem", { name: "Export" });
  act(() => sub.focus());
  fireEvent.keyDown(sub, { key: "ArrowRight" });
  const text = await screen.findByRole("menuitem", { name: "Text" });
  expect(text.closest('[data-slot="menubar-sub-content"]')).not.toBeNull();
  fireEvent.keyDown(text, { key: "ArrowLeft" });
  await waitFor(() => expect(document.activeElement).toBe(sub));
  const check = screen.getByRole("menuitemcheckbox", { name: "预览" });
  expect(check.getAttribute("aria-checked")).toBe("true");
  expect(
    check.querySelector('[data-slot="menubar-item-indicator"] svg'),
  ).not.toBeNull();
  fireEvent.click(check);
  expect(check.getAttribute("aria-checked")).toBe("false");
  const radio = screen.getByRole("menuitemradio", { name: "乙" });
  fireEvent.click(radio);
  expect(radio.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("Ctrl A").dataset.slot).toBe("menubar-shortcut");
  expect(screen.getByText("Workspace").dataset.slot).toBe("menubar-label");
  expect(screen.getByRole("separator").dataset.slot).toBe("menubar-separator");
  expect(menu.className).toContain(
    "max-w-(--radix-menubar-content-available-width)",
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  fireEvent.pointerDown(screen.getByRole("button", { name: "外部" }), {
    button: 0,
    pointerType: "mouse",
  });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
it("受控展开请求可以由父级拒绝或回写", async () => {
  const change = vi.fn();
  const view = (value: string) => (
    <Menubar value={value} onValueChange={change}>
      <MenubarMenu value="one">
        <MenubarTrigger>One</MenubarTrigger>
        <MenubarContent aria-label="One">
          <MenubarItem>内容</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
  const { rerender } = render(view(""));
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "One" }), {
    key: " ",
  });
  expect(change).toHaveBeenCalledExactlyOnceWith("one");
  expect(screen.queryByRole("menu")).toBeNull();
  rerender(view("one"));
  expect(await screen.findByRole("menu")).toBeTruthy();
});
it("退出动画焦点交接：仅同实例兄弟阻止关闭，先调用调用方并尊重 preventDefault", () => {
  const calls: boolean[] = [];
  const caller = vi.fn((event: Event) => calls.push(event.defaultPrevented));
  const view = (
    handler: MenubarContentProps["onFocusOutside"],
    value = "a",
  ) => (
    <>
      <Menubar value={value}>
        <MenubarMenu value="a">
          <MenubarTrigger>A</MenubarTrigger>
          <MenubarContent aria-label="A" onFocusOutside={handler}>
            <MenubarItem>A 内容</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu value="b">
          <MenubarTrigger>B</MenubarTrigger>
          <MenubarContent aria-label="B">
            <MenubarItem>B 内容</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <Menubar defaultValue="other">
        <MenubarMenu value="other">
          <MenubarTrigger>Other</MenubarTrigger>
          <MenubarContent aria-label="Other">
            <MenubarItem>其他</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </>
  );
  const { rerender } = render(view(caller));
  const a = content("A");
  rerender(view(caller, "b"));
  expect(a["data-menubar-instance"]).toBe(
    content("B")["data-menubar-instance"],
  );
  expect(a["data-menubar-instance"]).not.toBe(
    content("Other")["data-menubar-instance"],
  );
  // happy-dom 没有退出动画：直接把原语收到的回调作用于焦点外部事件。
  const target = document.createElement("div");
  const child = document.createElement("button");
  target.append(child);
  const invoke = (instance?: string) => {
    if (instance) target.dataset.menubarInstance = instance;
    else delete target.dataset.menubarInstance;
    const event = new CustomEvent("dismissableLayer.focusOutside", {
      cancelable: true,
      detail: { originalEvent: new FocusEvent("focusin") },
    });
    Object.defineProperty(event, "target", { value: child });
    (
      content("A").onFocusOutside as NonNullable<
        MenubarContentProps["onFocusOutside"]
      >
    )(event);
    return event;
  };
  calls.length = 0;
  expect(invoke(content("B")["data-menubar-instance"]).defaultPrevented).toBe(
    true,
  );
  expect(calls).toEqual([false]);
  expect(
    invoke(content("Other")["data-menubar-instance"]).defaultPrevented,
  ).toBe(false);
  expect(invoke().defaultPrevented).toBe(false);
  rerender(view((event) => event.preventDefault()));
  expect(invoke().defaultPrevented).toBe(true);
});
