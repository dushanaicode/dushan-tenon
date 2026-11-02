import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command";

const originalResizeObserver = globalThis.ResizeObserver;
const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function renderCommands() {
  const select = vi.fn();
  render(
    <Command label="查找命令">
      <CommandInput placeholder="搜索命令" />
      <CommandList label="查找命令">
        <CommandEmpty>没有匹配命令</CommandEmpty>
        <CommandGroup heading="页面">
          <CommandItem value="home" keywords={["首页"]} onSelect={select}>
            首页
          </CommandItem>
          <CommandItem
            value="files"
            keywords={["文件", "开发者"]}
            onSelect={select}
          >
            文件
            <CommandShortcut>Ctrl F</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="显示">
          <CommandItem value="dark" keywords={["深色"]} onSelect={select}>
            深色
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>,
  );
  return { input: screen.getByRole("combobox"), select };
}

it("the command ref, listbox and cmdk sizer remain on the actual auxiliary scrollport", () => {
  const ref = createRef<HTMLDivElement>();
  render(
    <Command>
      <CommandInput aria-label="search" />
      <CommandList ref={ref}>
        <CommandItem value="one">one</CommandItem>
      </CommandList>
    </Command>,
  );
  const list = screen.getByRole("listbox");
  expect(ref.current).toBe(list);
  expect(list.dataset.kit).toBe("scroll-area");
  expect(list.dataset.region).toBe("auxiliary");
  expect(list.dataset.axis).toBe("y");
  expect(list.classList.contains("scroll-py-1")).toBe(true);
  expect(list.firstElementChild?.hasAttribute("cmdk-list-sizer")).toBe(true);
});

it("渲染分组、条目、分隔线和快捷键提示", () => {
  renderCommands();
  const groups = screen.getAllByRole("group");
  expect(groups.map((group) => group.textContent)).toEqual([
    "首页文件Ctrl F",
    "深色",
  ]);
  const pages = screen.getByRole("group", {
    name: "页面",
  });
  expect(within(pages).getAllByRole("option")).toHaveLength(2);
  expect(screen.getByRole("separator")).toBeTruthy();
  expect(screen.getByText("Ctrl F").getAttribute("data-slot")).toBe(
    "command-shortcut",
  );
});

it.each(["文件", "开发者"])("cmdk 默认过滤支持标签和别名：%s", (search) => {
  const { input } = renderCommands();
  fireEvent.change(input, { target: { value: search } });
  const options = screen.getAllByRole("option");
  expect(options).toHaveLength(1);
  expect(options[0].getAttribute("data-value")).toBe("files");
});

it("无匹配时显示空结果", () => {
  const { input } = renderCommands();
  fireEvent.change(input, { target: { value: "不存在的命令" } });
  expect(screen.queryAllByRole("option")).toEqual([]);
  expect(screen.getByText("没有匹配命令")).toBeTruthy();
});

it("方向键选择、Enter 执行，并默认循环", async () => {
  const { input, select } = renderCommands();
  await waitFor(() =>
    expect(screen.getByRole("option", { selected: true }).textContent).toBe(
      "首页",
    ),
  );
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { selected: true }).textContent).toContain(
    "文件",
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select).toHaveBeenCalledExactlyOnceWith("files");
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(screen.getByRole("option", { selected: true }).textContent).toBe(
    "深色",
  );
});

it("关闭 vimBindings，Ctrl+J 不移动选中项", async () => {
  const { input } = renderCommands();
  await waitFor(() =>
    expect(screen.getByRole("option", { selected: true }).textContent).toBe(
      "首页",
    ),
  );
  fireEvent.keyDown(input, { key: "j", code: "KeyJ", ctrlKey: true });
  expect(screen.getByRole("option", { selected: true }).textContent).toBe(
    "首页",
  );
});

it("区分 cmdk 的 false/true 禁用状态，键盘与点击均跳过禁用命令", async () => {
  const select = vi.fn();
  render(
    <Command>
      <CommandInput aria-label="查找命令" />
      <CommandList>
        <CommandItem value="ready" onSelect={select}>
          可用命令
        </CommandItem>
        <CommandItem value="locked" disabled onSelect={select}>
          禁用命令
        </CommandItem>
      </CommandList>
    </Command>,
  );
  const ready = screen.getByRole("option", { name: "可用命令" });
  const locked = screen.getByRole("option", { name: "禁用命令" });
  expect(ready.dataset.disabled).toBe("false");
  expect(locked.dataset.disabled).toBe("true");
  await waitFor(() => expect(ready.dataset.selected).toBe("true"));
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(ready.dataset.selected).toBe("true");
  fireEvent.click(locked);
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select).toHaveBeenCalledExactlyOnceWith("ready");
});
