import {
  act,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Avatar,
  AvatarFallback,
  Button,
  Combobox,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorView,
  FormField,
  FormSection,
  Input,
  Kbd,
  KbdGroup,
  KeyValueList,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Spinner,
  StatusDot,
  StreamText,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Timeline,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@/kit";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";

function target(selector: string, root: ParentNode = document) {
  const element = root.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  return element as HTMLElement;
}

afterEach(() => act(() => toast.dismiss()));

it("标题和现有文字 slot 保留语义、完整文案与 DOM 层级", () => {
  render(
    <>
      <PageHeader
        title="页面标题"
        description="页面说明"
        leading={<span>前导</span>}
      />
      <FormSection title="字段分组" description="分组说明">
        <FormField label="名称" description="字段说明" error="字段错误">
          {(control) => <Input {...control} />}
        </FormField>
      </FormSection>
      <EmptyState title="没有内容" description="空态说明" />
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
      <Avatar>
        <AvatarFallback>用户</AvatarFallback>
      </Avatar>
      <ErrorView title="加载失败" message="错误说明" detail="追踪码" />
      <KeyValueList items={[{ key: "total", label: "数量", value: 12 }]} />
    </>,
  );
  const header = target('[data-slot="page-header"]');
  expect(target('[data-part="title"]', header)).toBe(
    screen.getByRole("heading", { level: 1 }),
  );
  expect(target('[data-part="description"]', header).textContent).toBe(
    "页面说明",
  );
  expect(header.children).toHaveLength(1);
  expect(header.firstElementChild?.children).toHaveLength(2);
  expect(screen.getByText("前导").parentElement).toBe(header.firstElementChild);
  expect(
    [
      target('[data-part="title"]', header),
      target('[data-part="description"]', header),
      target('[data-slot="field-legend"]'),
      target('[data-slot="empty-title"]'),
    ].map((element) => [
      element.tagName,
      element.className,
      element.textContent,
    ]),
  ).toMatchInlineSnapshot(`
    [
      [
        "H1",
        "text-2xl font-semibold tracking-tight",
        "页面标题",
      ],
      [
        "P",
        "text-body text-muted-foreground",
        "页面说明",
      ],
      [
        "LEGEND",
        "float-left w-full text-body font-semibold",
        "字段分组",
      ],
      [
        "DIV",
        "text-lg font-medium",
        "没有内容",
      ],
    ]
  `);
  for (const slot of [
    "field-set",
    "field-description",
    "field-group",
    "field-label",
    "field-error",
    "empty-description",
    "kbd",
    "kbd-group",
    "avatar",
    "avatar-fallback",
  ])
    target(`[data-slot="${slot}"]`);
  expect(target('[data-slot="avatar"]').tagName).toBe("SPAN");
  expect(target('[data-slot="kbd"]').tagName).toBe("KBD");
  const error = target('[data-slot="error-view"]');
  expect(target('[data-part="title"]', error).tagName).toBe("H2");
  expect(target('[data-part="description"]', error).textContent).toBe(
    "错误说明",
  );
  expect(target('[data-part="detail"]', error).textContent).toBe("追踪码");
  const values = target('[data-slot="key-value-list"]');
  expect(target('[data-part="label"]', values).tagName).toBe("DT");
  expect(target('[data-part="value"]', values).tagName).toBe("DD");
});

it("Timeline 保留行与文字语义，StreamText 保留代码结构", () => {
  render(
    <>
      <Timeline
        items={[
          { id: "one", title: "完成", time: "今天", description: "已保存" },
          { id: "two", title: "开始" },
        ]}
      />
      <StreamText
        text={"代码：`count`\n\n```text\nhello\n```"}
        isAnimating={false}
      />
      <Button>
        <Spinner />
        读取
      </Button>
    </>,
  );
  const rows = document.querySelectorAll<HTMLElement>(
    '[data-slot="timeline-item"]',
  );
  expect(rows).toHaveLength(2);
  expect(target('[data-part="title"]', rows[0]).textContent).toBe("完成");
  expect(target('[data-part="time"]', rows[0]).textContent).toBe("今天");
  expect(target('[data-part="description"]', rows[0]).textContent).toBe(
    "已保存",
  );
  target('[data-slot="timeline-connector"]');
  target('[data-slot="timeline-dot"]');
  target('[data-slot="stream-text"] code');
  target('[data-slot="stream-text"] pre');
});

it.each([25, null])(
  "Progress %s 保留真实 transform、ARIA 与功能性循环",
  (value) => {
    render(
      <>
        <Progress value={value} max={50} aria-label="处理进度" />
        <Skeleton />
        <Spinner aria-label="加载中" />
        <StatusDot running />
      </>,
    );
    const bar = screen.getByRole("progressbar", { name: "处理进度" });
    expect(bar.dataset.slot).toBe("progress");
    expect(bar.getAttribute("aria-valuenow")).toBe(
      value === null ? null : "25",
    );
    expect(bar.getAttribute("aria-valuemax")).toBe("50");
    const indicator = target('[data-slot="progress-indicator"]', bar);
    const transform = value === null ? "translateX(-65%)" : "translateX(-50%)";
    expect(indicator.style.transform).toBe(
      `var(--progress-transform, ${transform})`,
    );
    expect(
      indicator.classList.contains(
        value === null ? "kit-pulse" : "motion-transform",
      ),
    ).toBe(true);
    for (const slot of ["skeleton", "spinner", "status-dot"]) {
      const element = target(`[data-slot="${slot}"]`);
      expect(element.hasAttribute("data-motion-item")).toBe(true);
      expect(
        element.classList.contains(
          slot === "spinner" ? "kit-spin" : "kit-pulse",
        ),
      ).toBe(true);
    }
  },
);

const columns: readonly DataTableColumn<string>[] = [
  {
    id: "name",
    header: "名称",
    cell: (row) => row,
    rowHeader: true,
    sortable: true,
  },
];
it("表格首列、排序、选中、横滚与稳定行 ID 保持", () => {
  const sort = vi.fn();
  const select = vi.fn();
  const props = {
    columns,
    caption: "表格",
    getRowId: (row: string) => row,
    selection: {
      value: new Set(["甲"]),
      onChange: select,
      rowLabel: (row: string) => row,
    },
    sorting: { value: null, onChange: sort },
  };
  const { container, rerender } = render(
    <DataTable {...props} rows={undefined} />,
  );
  rerender(<DataTable {...props} rows={["甲", "乙"]} />);
  const region = screen.getByRole("region", { name: "表格" });
  expect(region.dataset.part).toBe("table-scroll");
  expect(region.parentElement?.getAttribute("data-slot")).toBe(
    "table-container",
  );
  expect(region.tabIndex).toBe(0);
  expect(region.dataset.region).toBe("auxiliary");
  expect(region.dataset.axis).toBe("x");
  const row = screen
    .getByRole("rowheader", { name: "甲" })
    .closest("tr") as HTMLTableRowElement;
  expect(row.dataset.state).toBe("selected");
  expect(
    Array.from(row.children, (cell) => [
      cell.tagName,
      cell.getAttribute("scope"),
    ]),
  ).toEqual([
    ["TD", null],
    ["TH", "row"],
  ]);
  expect(
    within(row.cells[0]).getByRole("checkbox").getAttribute("data-state"),
  ).toBe("checked");
  fireEvent.click(screen.getByRole("button", { name: "名称" }));
  expect(sort).toHaveBeenLastCalledWith({ id: "name", desc: false });
  rerender(
    <DataTable
      {...props}
      rows={["乙", "甲"]}
      sorting={{ value: { id: "name", desc: true }, onChange: sort }}
    />,
  );
  expect(screen.getByRole("rowheader", { name: "甲" }).closest("tr")).toBe(row);
  expect(
    screen
      .getByRole("columnheader", { name: "名称" })
      .getAttribute("aria-sort"),
  ).toBe("descending");
  rerender(<DataTable {...props} rows={["丙"]} />);
  expect(container.querySelector("tr.kit-enter")).toBeNull();
});

it("Tabs 多实例的 vertical/line 与键盘状态独立", async () => {
  render(
    (["horizontal", "vertical"] as const).map((orientation) => (
      <Tabs key={orientation} orientation={orientation} defaultValue="one">
        <TabsList variant="line" aria-label={orientation}>
          <TabsTrigger value="one">第一项</TabsTrigger>
          <TabsTrigger value="two">第二项</TabsTrigger>
        </TabsList>
        <TabsContent value="one">第一面板</TabsContent>
        <TabsContent value="two">第二面板</TabsContent>
      </Tabs>
    )),
  );
  const lists = screen.getAllByRole("tablist");
  expect(lists).toHaveLength(2);
  for (const list of lists) {
    expect(list.dataset.variant).toBe("line");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs[0].getAttribute("data-state")).toBe("active");
    expect(tabs[0].className).toContain(
      "group-data-[variant=line]/list:data-[state=active]:after:opacity-100",
    );
    act(() => tabs[0].focus());
    fireEvent.keyDown(tabs[0], {
      key:
        list.getAttribute("aria-orientation") === "vertical"
          ? "ArrowDown"
          : "ArrowRight",
    });
    await waitFor(() =>
      expect(tabs[1].getAttribute("data-state")).toBe("active"),
    );
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  }
});

it.each(["dialog", "sheet", "popover"] as const)(
  "%s 的身份位于真实 Portal 内容，派生 slot/props 不吞身份",
  async (kind) => {
    const description = "浮层说明";
    const { container } = render(
      kind === "dialog" ? (
        <Dialog open>
          <DialogContent data-slot="derived-dialog" data-kit="wrong">
            <DialogTitle>对话框</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogContent>
        </Dialog>
      ) : kind === "sheet" ? (
        <Sheet open>
          <SheetContent data-slot="derived-sheet" data-kit="wrong">
            <SheetTitle>面板</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open>
          <PopoverTrigger>打开</PopoverTrigger>
          <PopoverContent data-slot="derived-popover" data-kit="wrong">
            内容
          </PopoverContent>
        </Popover>
      ),
    );
    const content = await screen.findByRole("dialog");
    expect(content.tagName).toBe("DIV");
    expect(content.dataset.kit).toBe(kind);
    expect(content.dataset.slot).toBe(`derived-${kind}`);
    expect(content.dataset.state).toBe("open");
    expect(container.contains(content)).toBe(false);
    if (kind !== "popover") {
      target(`[data-slot="${kind}-overlay"]`);
      target(`[data-slot="${kind}-title"]`, content);
      target(`[data-slot="${kind}-description"]`, content);
    }
    expect(document.querySelector("dialog")).toBeNull();
  },
);

it("ConfirmDialog 保留 alert-dialog 的 Portal 身份和 pending 禁用", async () => {
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      pending
      title="删除记录"
      description="确认删除"
      confirmLabel="删除"
      onConfirm={vi.fn()}
      onOpenChange={onOpenChange}
    />,
  );
  const dialog = await screen.findByRole("alertdialog", { name: "删除记录" });
  expect(dialog.dataset.kit).toBe("alert-dialog");
  for (const slot of ["content", "overlay", "title", "description"])
    target(`[data-slot="alert-dialog-${slot}"]`);
  expect(
    (screen.getByRole("button", { name: "删除" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("DropdownMenu 打开后沿用 slot/状态，补 radio 指示器且 Esc 恢复焦点", async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>菜单</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>外观</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="dark">
          <DropdownMenuRadioItem value="dark">深色</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" disabled>
            浅色
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole("button", { name: "菜单" });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" });
  const menu = await screen.findByRole("menu");
  expect(menu.dataset.slot).toBe("dropdown-menu-content");
  expect(target('[data-slot="dropdown-menu-label"]', menu).textContent).toBe(
    "外观",
  );
  const checked = screen.getByRole("menuitemradio", { name: "深色" });
  expect(checked.dataset.state).toBe("checked");
  target('[data-slot="dropdown-menu-item-indicator"] svg', checked);
  expect(
    screen
      .getByRole("menuitemradio", { name: "浅色" })
      .hasAttribute("data-disabled"),
  ).toBe(true);
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("Select 内容与 label/item/indicator 在 Portal 内沿用 slot", async () => {
  render(
    <Select defaultOpen defaultValue="one">
      <SelectTrigger aria-label="选择">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>选项</SelectLabel>
          <SelectItem value="one">第一项</SelectItem>
          <SelectItem value="two">第二项</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>,
  );
  const content = await screen.findByRole("listbox");
  expect(content.dataset.slot).toBe("select-content");
  target('[data-slot="select-label"]', content);
  const item = screen.getByRole("option", { name: "第一项" });
  expect(item.dataset.state).toBe("checked");
  target('[data-slot="select-item-indicator"]', item);
});

it("CommandDialog 和 Combobox 组合保留基类内容身份", async () => {
  const view = render(
    <CommandDialog open title="命令" description="选择命令">
      <CommandInput placeholder="搜索" />
      <CommandList>
        <CommandGroup heading="导航">
          <CommandItem>首页</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>,
  );
  const dialog = await screen.findByRole("dialog", { name: "命令" });
  expect(dialog.dataset.kit).toBe("dialog");
  expect(dialog.hasAttribute("data-command-dialog")).toBe(true);
  for (const slot of [
    "command",
    "command-input",
    "command-list",
    "command-group",
    "command-item",
  ])
    target(`[data-slot="${slot}"]`, dialog);
  view.unmount();
  // Radix FocusScope 在卸载后用 setTimeout(0) 归还焦点；让它先跑完，否则会在下一个浮层打开后把焦点抢回 body，浮层被当作“焦点移出”而关闭。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  render(
    <>
      <label htmlFor="workspace">工作区</label>
      <Combobox
        id="workspace"
        placeholder="工作区"
        searchPlaceholder="搜索工作区"
        emptyText="无匹配"
        options={[{ value: "one", label: "默认" }]}
        value="one"
        onValueChange={vi.fn()}
      />
    </>,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "工作区" }));
  const popover = await screen.findByRole("dialog");
  expect(popover.dataset.kit).toBe("popover");
  target('[data-slot="command"]', popover);
});

it("Tooltip 的 Portal 仍使用反色配对，Toast 复用 Sonner 实际 DOM", async () => {
  const view = render(
    <Tooltip open>
      <TooltipTrigger>说明</TooltipTrigger>
      <TooltipContent>提示内容</TooltipContent>
    </Tooltip>,
  );
  await screen.findByRole("tooltip");
  const tooltip = target('[data-slot="tooltip-content"]');
  expect(tooltip.classList.contains("bg-foreground")).toBe(true);
  expect(tooltip.classList.contains("text-background")).toBe(true);
  expect(target("svg", tooltip).classList.contains("fill-foreground")).toBe(
    true,
  );
  view.unmount();
  render(<Toaster />);
  act(() => {
    toast("完成提示", { description: "操作完成" });
  });
  await screen.findByText("完成提示");
  const notification = target("[data-sonner-toast]");
  target("[data-sonner-toaster]");
  expect(target("[data-title]", notification).textContent).toBe("完成提示");
  expect(target("[data-description]", notification).textContent).toBe(
    "操作完成",
  );
  expect(notification.classList.contains("shadow-popover")).toBe(true);
});

const i18n = createKitTestI18n();
function render(ui: ReactNode) {
  return renderView(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}

beforeEach(() => {
  void i18n.changeLanguage("zh-CN");
});
