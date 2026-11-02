import {
  act,
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/kit";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";

let errorSpy: MockInstance;
let warnSpy: MockInstance;

beforeEach(() => {
  void i18n.changeLanguage("zh-CN");
  errorSpy = vi.spyOn(console, "error");
  warnSpy = vi.spyOn(console, "warn");
});

afterEach(() => {
  cleanup();
  try {
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
});

function MenuExample({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("light");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>用户菜单</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>账户</DropdownMenuLabel>
          <DropdownMenuItem>个人资料</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            setValue(next);
            onChange?.(next);
          }}
        >
          <DropdownMenuRadioItem value="light">浅色</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" disabled>
            跟随系统
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">深色</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it.each(["Enter", " ", "ArrowDown"])(
    "%s 打开菜单，含标签与分隔线，Esc 关闭并还原焦点",
    async (key) => {
      render(<MenuExample />);
      const trigger = screen.getByRole("button", { name: "用户菜单" });
      expect(trigger.getAttribute("data-kit")).toBe("button");
      expect(trigger.getAttribute("data-slot")).toBe("dropdown-menu-trigger");
      expect(trigger.children).toHaveLength(1);
      expect(trigger.firstElementChild?.getAttribute("data-part")).toBe("face");
      act(() => trigger.focus());
      fireEvent.keyDown(trigger, { key });
      const menu = await screen.findByRole("menu");
      expect(screen.getByText("账户").dataset.slot).toBe("dropdown-menu-label");
      expect(screen.getByRole("separator")).toBeTruthy();
      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole("menuitem", { name: "个人资料" }),
        );
      });
      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(trigger);
      });
    },
  );

  it("指针打开，Radio 的选中状态与选择回调正确", async () => {
    const onChange = vi.fn();
    render(<MenuExample onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "用户菜单" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    const light = await screen.findByRole("menuitemradio", { name: "浅色" });
    const dark = screen.getByRole("menuitemradio", { name: "深色" });
    expect(light.getAttribute("aria-checked")).toBe("true");
    expect(dark.getAttribute("aria-checked")).toBe("false");
    act(() => light.focus());
    fireEvent.keyDown(light, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(dark));
    fireEvent.keyDown(dark, { key: "Enter" });
    expect(onChange.mock.calls).toEqual([["dark"]]);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    expect(
      (await screen.findByRole("menuitemradio", { name: "深色" })).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });
});

it("Avatar 显示回退文字", () => {
  render(
    <Avatar>
      <AvatarFallback>本</AvatarFallback>
    </Avatar>,
  );
  expect(screen.getByText("本").dataset.slot).toBe("avatar-fallback");
});

it("补充复选、子菜单和快捷键；键盘、禁用与焦点归还", async () => {
  const selected = vi.fn();
  function Example() {
    const [checked, setChecked] = useState(true);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>扩展菜单</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={checked}
            onCheckedChange={(next) => setChecked(next === true)}
            onSelect={(event) => event.preventDefault()}
          >
            预览
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked disabled onSelect={selected}>
            锁定
          </DropdownMenuCheckboxItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Export<DropdownMenuShortcut>Ctrl E</DropdownMenuShortcut>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuItem onSelect={selected}>Alpha</DropdownMenuItem>
              <DropdownMenuItem disabled onSelect={selected}>
                Disabled
              </DropdownMenuItem>
              <DropdownMenuItem>Beta</DropdownMenuItem>
              <DropdownMenuItem>
                很长的中文说明仍然保留完整可读内容
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const { container } = render(<Example />);
  const trigger = screen.getByRole("button", { name: "扩展菜单" });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" });
  const check = await screen.findByRole("menuitemcheckbox", { name: "预览" });
  expect(check.getAttribute("aria-checked")).toBe("true");
  expect(check.dataset.slot).toBe("dropdown-menu-checkbox-item");
  expect(
    check.querySelector('[data-slot="dropdown-menu-item-indicator"] svg'),
  ).not.toBeNull();
  act(() => check.focus());
  fireEvent.keyDown(check, { key: " " });
  expect(check.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "锁定" }));
  expect(selected).not.toHaveBeenCalled();
  fireEvent.keyDown(check, { key: "ArrowDown" });
  const sub = screen.getByRole("menuitem", { name: "Export Ctrl E" });
  await waitFor(() => expect(document.activeElement).toBe(sub));
  fireEvent.keyDown(sub, { key: "ArrowRight" });
  const alpha = await screen.findByRole("menuitem", { name: "Alpha" });
  await waitFor(() => expect(document.activeElement).toBe(alpha));
  const panel = alpha.closest(
    '[data-slot="dropdown-menu-sub-content"]',
  ) as HTMLElement;
  expect(container.contains(panel)).toBe(false);
  expect(panel.className).toContain(
    "max-w-(--radix-dropdown-menu-content-available-width)",
  );
  expect(panel.hasAttribute("data-motion-item")).toBe(true);
  expect(panel.hasAttribute("data-kit")).toBe(false);
  expect(sub.getAttribute("aria-expanded")).toBe("true");
  expect(sub.className).toContain("data-[state=open]:bg-accent");
  expect(screen.getByText("Ctrl E").dataset.slot).toBe(
    "dropdown-menu-shortcut",
  );
  fireEvent.keyDown(alpha, { key: "ArrowDown" });
  const beta = screen.getByRole("menuitem", { name: "Beta" });
  await waitFor(() => expect(document.activeElement).toBe(beta));
  fireEvent.keyDown(beta, { key: "End" });
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain("很长的中文"),
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  await waitFor(() => expect(document.activeElement).toBe(alpha));
  fireEvent.keyDown(alpha, { key: "b" });
  await waitFor(() => expect(document.activeElement).toBe(beta));
  fireEvent.keyDown(beta, { key: "ArrowLeft" });
  await waitFor(() => expect(document.activeElement).toBe(sub));
  fireEvent.keyDown(sub, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("共享常量抽取保留原 DropdownMenu 的内容与条目类名、指示器结构", async () => {
  render(<MenuExample />);
  fireEvent.keyDown(screen.getByRole("button", { name: "用户菜单" }), {
    key: "Enter",
  });
  const menu = await screen.findByRole("menu");
  expect(menu.className).toBe(
    "kit-pop z-50 min-w-32 max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin) rounded-lg border border-border bg-popover text-popover-foreground shadow-popover focus-visible:outline-none",
  );
  const scroll = menu.firstElementChild;
  expect(scroll?.getAttribute("data-kit")).toBe("scroll-area");
  expect(scroll?.getAttribute("data-region")).toBe("auxiliary");
  expect(scroll?.className).toBe("max-h-[inherit] rounded-[inherit] p-1");
  expect(screen.getByRole("menuitem", { name: "个人资料" }).className).toBe(
    "relative flex min-h-control cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-body select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50 kit-icon-control [&_svg]:pointer-events-none [&_svg]:shrink-0",
  );
  const indicator = screen.getByRole("menuitemradio", {
    name: "浅色",
  }).firstElementChild;
  expect(indicator?.tagName).toBe("SPAN");
  expect(indicator?.className).toBe(
    "pointer-events-none absolute left-2 flex size-4 items-center justify-center",
  );
});

const i18n = createKitTestI18n();
function render(ui: ReactNode) {
  return renderView(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}
