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
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
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
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
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

function DialogExample({ footer = false }: { footer?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>打开编辑</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!footer}>
        <DialogHeader>
          <DialogTitle>编辑名称</DialogTitle>
          <DialogDescription>输入新的显示名称。</DialogDescription>
        </DialogHeader>
        <Input aria-label="名称" />
        <DialogFooter showCloseButton={footer} />
      </DialogContent>
    </Dialog>
  );
}

function expectDescription(element: HTMLElement, description: string) {
  const id = element.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  expect(document.getElementById(id as string)?.textContent).toBe(description);
}

async function clickOutside(element: Element) {
  // 外部监听在 setTimeout(0) 中注册，等待该任务后再模拟用户交互。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // 当前 Radix 将主键外部交互的关闭延迟至 click，补齐指针事件序列。
  fireEvent.pointerDown(element, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(element, { button: 0, pointerType: "mouse" });
  fireEvent.click(element);
}

describe("Dialog", () => {
  it("关联标题与说明，首焦点进入内容，Esc 关闭并返回触发器", async () => {
    render(<DialogExample />);
    const trigger = screen.getByRole("button", { name: "打开编辑" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "编辑名称" });
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(document.getElementById(titleId as string)?.textContent).toBe(
      "编辑名称",
    );
    expectDescription(dialog, "输入新的显示名称。");
    const input = screen.getByRole("textbox", { name: "名称" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const close = screen.getByRole("button", { name: "关闭" });
    expect(close.classList.contains("size-control")).toBe(true);
    expect(close.classList.contains("focus-visible:ring-ring")).toBe(true);
    act(() => close.focus());
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("点击遮罩关闭", async () => {
    render(<DialogExample />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开编辑" }));
    });
    expect(screen.getByRole("dialog", { name: "编辑名称" })).toBeTruthy();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await clickOutside(overlay as Element);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each([false, true])("关闭文案跟随语言（footer=%s）", async (footer) => {
    render(<DialogExample footer={footer} />);
    fireEvent.click(screen.getByRole("button", { name: "打开编辑" }));
    expect(await screen.findByRole("button", { name: "关闭" })).toBeTruthy();
    await act(() => i18n.changeLanguage("en-US"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("ConfirmDialog", () => {
  it("异步确认保留焦点并锁定处理中交互", async () => {
    let finish!: () => void;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let fail = true;
    const onConfirm = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      const [error, setError] = useState("");
      return (
        <>
          <Button onClick={() => setOpen(true)}>重置布局</Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="重置当前工作区布局"
            confirmLabel="重置当前工作区布局"
            description={error || "恢复面板尺寸与显隐。"}
            onConfirm={async () => {
              onConfirm();
              await operation;
              if (fail) setError("保存失败，请重试。");
              else setOpen(false);
            }}
          />
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "重置布局" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog");
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "重置当前工作区布局" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await clickOutside(
      document.querySelector('[data-slot="alert-dialog-overlay"]') as Element,
    );
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    act(() => confirm.focus());
    for (const keyboard of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
    ]) {
      expect(fireEvent.keyDown(confirm, { key: "Enter", ...keyboard })).toBe(
        false,
      );
    }
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveProperty("disabled", true);
    expect(cancel).toHaveProperty("disabled", true);
    await act(async () => finish());
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    expectDescription(dialog, "保存失败，请重试。");
    expect(confirm).toHaveProperty("disabled", false);
    expect(document.activeElement).toBe(confirm);
    fail = false;
    await act(async () => fireEvent.click(confirm));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("首焦点在取消，确认由调用方关闭，处理中禁止取消与 Esc", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const props = {
      title: "删除记录",
      confirmLabel: "删除记录",
      description: "删除后无法恢复。",
      onConfirm,
      onOpenChange,
      tone: "destructive" as const,
    };
    const { rerender } = render(<ConfirmDialog {...props} open />);
    const dialog = await screen.findByRole("alertdialog", {
      name: "删除记录",
    });
    expectDescription(dialog, "删除后无法恢复。");
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "删除记录" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(confirm.classList.contains("bg-destructive")).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBe(dialog);

    rerender(<ConfirmDialog {...props} open pending />);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(confirm.querySelector('[data-slot="spinner"]')).not.toBeNull();
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await clickOutside(
      document.querySelector('[data-slot="alert-dialog-overlay"]') as Element,
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    rerender(<ConfirmDialog {...props} open={false} />);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("受控关闭后返回打开前的焦点", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>删除</Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="删除记录"
            confirmLabel="删除记录"
            description="删除后无法恢复。"
            onConfirm={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "删除" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "删除记录" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});

describe("Sheet", () => {
  it.each(["top", "right", "bottom", "left"] as const)(
    "%s 方向正确，Esc 关闭并返回触发器",
    async (side) => {
      render(
        <Sheet>
          <SheetTrigger asChild>
            <Button>打开面板</Button>
          </SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>详情</SheetTitle>
              <SheetDescription>查看记录详情。</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>,
      );
      const trigger = screen.getByRole("button", { name: "打开面板" });
      fireEvent.click(trigger);
      const dialog = await screen.findByRole("dialog", { name: "详情" });
      expectDescription(dialog, "查看记录详情。");
      expect(dialog.getAttribute("data-side")).toBe(side);
      expect(dialog.classList.contains("kit-slide")).toBe(true);
      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "关闭" }),
        );
      });
      fireEvent.keyDown(dialog, { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(trigger);
      });
    },
  );
});

describe("Select", () => {
  it.each(["Enter", " ", "ArrowDown"])(
    "%s 打开，方向键跳过禁用项，Enter 选中并显示文字",
    async (key) => {
      const onValueChange = vi.fn();
      render(
        <Select onValueChange={onValueChange}>
          <SelectTrigger aria-label="城市" aria-invalid="true">
            <SelectValue placeholder="请选择城市" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>城市</SelectLabel>
              <SelectItem value="beijing">北京</SelectItem>
              <SelectItem value="shanghai" disabled>
                上海
              </SelectItem>
              <SelectItem value="shenzhen">深圳</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>,
      );
      const trigger = screen.getByRole("combobox", { name: "城市" });
      expect(trigger.getAttribute("aria-invalid")).toBe("true");
      act(() => trigger.focus());
      fireEvent.keyDown(trigger, { key });
      const first = await screen.findByRole("option", { name: "北京" });
      const disabled = screen.getByRole("option", { name: "上海" });
      const last = screen.getByRole("option", { name: "深圳" });
      expect(disabled.getAttribute("aria-disabled")).toBe("true");
      await waitFor(() => expect(document.activeElement).toBe(first));
      fireEvent.keyDown(first, { key: "ArrowDown" });
      await waitFor(() => expect(document.activeElement).toBe(last));
      fireEvent.keyDown(last, { key: "Enter" });
      expect(onValueChange.mock.calls).toEqual([["shenzhen"]]);
      await waitFor(() => {
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(trigger.textContent).toBe("深圳");
        expect(document.activeElement).toBe(trigger);
      });
    },
  );
});

describe("Tooltip", () => {
  it("无需外层 Provider，聚焦显示说明，失焦后消失", async () => {
    render(
      <Tooltip>
        <TooltipTrigger asChild>
          <Button>帮助</Button>
        </TooltipTrigger>
        <TooltipContent>查看操作说明。</TooltipContent>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "帮助" });
    fireEvent.focus(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe("查看操作说明。");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    fireEvent.blur(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });
});

describe("Toaster", () => {
  it.each([
    ["zh-CN", "通知", "关闭通知"],
    ["en-US", "Notifications", "Close notification"],
  ])(
    "%s 消息、说明和名称正确，使用令牌并可卸载",
    async (language, name, close) => {
      await act(() => i18n.changeLanguage(language));
      const { rerender } = render(<Toaster />);
      let id: string | number = "";
      act(() => {
        id = toast("消息", { description: "说明" });
      });
      expect(await screen.findByText("消息")).toBeTruthy();
      expect(await screen.findByText("说明")).toBeTruthy();
      expect(screen.getByRole("region", { name })).toBeTruthy();
      const container = document.querySelector(
        "[data-sonner-toaster]",
      ) as HTMLElement;
      expect(container.style.getPropertyValue("--normal-bg")).toBe(
        "var(--popover)",
      );
      rerender(<Toaster closeButton />);
      expect(screen.getByRole("button", { name: close })).toBeTruthy();
      act(() => {
        toast.dismiss(id);
      });
      await waitFor(() => {
        expect(screen.queryByText("消息")).toBeNull();
        expect(screen.queryByText("说明")).toBeNull();
      });
    },
  );
});

const i18n = createKitTestI18n();
function render(ui: ReactNode) {
  return renderView(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}
