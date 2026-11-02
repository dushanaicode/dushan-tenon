import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { type FormEvent, useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { FormSection } from "../ui/form-section";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  type FormContainerProps,
  FormDialog,
  FormSheet,
} from "./form-container";

const originalResizeObserver = globalThis.ResizeObserver;
const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);
let errorSpy: MockInstance;
let warnSpy: MockInstance;

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

beforeEach(() => {
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

describe.each([
  { name: "FormSheet", Component: FormSheet, footer: "sheet-footer" },
  { name: "FormDialog", Component: FormDialog, footer: "dialog-footer" },
])("$name", ({ Component, footer }) => {
  let props: FormContainerProps;

  beforeEach(() => {
    props = {
      open: true,
      onOpenChange: vi.fn(),
      title: "编辑记录",
      description: "填写记录信息",
      onSubmit: vi.fn(),
      children: (
        <FormSection title="基本信息">
          <FormField label="名称">
            {(control) => <Input {...control} name="name" />}
          </FormField>
        </FormSection>
      ),
    };
  });

  it("由 open 控制显示，标题与描述关联正确", async () => {
    const { rerender } = renderKit(<Component {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Component {...props} />);
    const dialog = await screen.findByRole("dialog", { name: "编辑记录" });
    const descriptionId = dialog.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId as string)?.textContent).toBe(
      "填写记录信息",
    );
    expect(screen.getByRole("group", { name: "基本信息" })).toBeTruthy();
    expect(screen.getByLabelText("名称")).toBeTruthy();
    rerender(<Component {...props} open={false} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("省略描述时不引用不存在的描述节点", async () => {
    renderKit(<Component {...props} description={undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "编辑记录" });
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByText("填写记录信息")).toBeNull();
  });

  it("底部提交按钮关联表单并透传提交事件，取消请求关闭", async () => {
    const submitted = vi.fn();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      expect(event.defaultPrevented).toBe(true);
      submitted(new FormData(event.currentTarget).get("name"));
    });
    renderKit(<Component {...props} onSubmit={onSubmit} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "新名称" },
    });
    const submit = screen.getByRole("button", {
      name: "提交",
    }) as HTMLButtonElement;
    const form = dialog.querySelector("form") as HTMLFormElement;
    expect(form.id).toBeTruthy();
    expect(submit.type).toBe("submit");
    expect(submit.getAttribute("form")).toBe(form.id);
    expect(form.contains(submit)).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submitted).toHaveBeenCalledExactlyOnceWith("新名称");
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("pending 禁用取消、提交、关闭、Esc 与外点，提交按钮显示 Spinner", async () => {
    renderKit(<Component {...props} pending />);
    const dialog = await screen.findByRole("dialog");
    const submit = screen.getByRole("button", {
      name: "提交",
    }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", {
      name: "取消",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(submit.querySelector('[data-slot="spinner"]')).not.toBeNull();
    fireEvent.click(submit);
    fireEvent.click(cancel);
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const overlay = document.querySelector(
      '[data-slot$="-overlay"]',
    ) as Element;
    fireEvent.pointerDown(overlay, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(overlay, { button: 0, pointerType: "mouse" });
    fireEvent.click(overlay);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("submitDisabled 只禁用提交，默认及自定义文案正确", async () => {
    const { rerender, i18n } = renderKit(
      <Component {...props} submitDisabled />,
    );
    await screen.findByRole("dialog");
    const submit = screen.getByRole("button", {
      name: "提交",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(
      (screen.getByRole("button", { name: "取消" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(submit);
    fireEvent.submit(submit.form as HTMLFormElement);
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(() => i18n.changeLanguage("en-US"));
    expect(screen.getByRole("button", { name: "Submit" })).toBe(submit);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    rerender(
      <Component {...props} submitLabel="保存记录" cancelLabel="放弃编辑" />,
    );
    expect(screen.getByRole("button", { name: "保存记录" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "放弃编辑" })).toBeTruthy();
  });

  it("输入法确认和重复 Enter 不提交表单", async () => {
    renderKit(
      <Component {...props}>
        <Input aria-label="名称" />
        <Textarea aria-label="说明" />
      </Component>,
    );
    const input = await screen.findByRole("textbox", { name: "名称" });
    for (const keyboard of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
    ]) {
      expect(fireEvent.keyDown(input, { key: "Enter", ...keyboard })).toBe(
        false,
      );
    }
    const textarea = screen.getByRole("textbox", { name: "说明" });
    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
    fireEvent.change(textarea, { target: { value: "第一行\n第二行" } });
    expect(textarea).toHaveProperty("value", "第一行\n第二行");
    expect(props.onSubmit).not.toHaveBeenCalled();
    // 普通 Enter 留给浏览器原生表单提交，不把按键全局映射到动作。
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("异步提交防连点，失败保留输入，成功关闭后返焦", async () => {
    let finish!: () => void;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onSubmit = vi.fn();
    let fail = true;
    function Example() {
      const [open, setOpen] = useState(false);
      const [error, setError] = useState("");
      return (
        <>
          <Button onClick={() => setOpen(true)}>打开编辑</Button>
          <Component
            open={open}
            onOpenChange={setOpen}
            title="编辑记录"
            onSubmit={async () => {
              onSubmit();
              await operation;
              if (fail) setError("保存失败");
              else setOpen(false);
            }}
          >
            <Input aria-label="名称" />
            {error && <p role="alert">{error}</p>}
          </Component>
        </>
      );
    }
    renderKit(<Example />);
    const trigger = screen.getByRole("button", { name: "打开编辑" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const input = screen.getByRole("textbox", { name: "名称" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "未保存名称" } });
    const submit = screen.getByRole("button", { name: "提交" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submit).toHaveProperty("disabled", true);
    await act(async () => finish());
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByRole("alert").textContent).toBe("保存失败");
    expect(input).toHaveProperty("value", "未保存名称");
    fail = false;
    await act(async () => fireEvent.click(submit));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("表单主体独立滚动，操作栏固定在底部且使用语义令牌", async () => {
    renderKit(<Component {...props} />);
    const dialog = await screen.findByRole("dialog");
    const form = dialog.querySelector("form") as HTMLFormElement;
    const scroll = form.closest('[data-kit="scroll-area"]');
    expect(scroll?.getAttribute("data-region")).toBe("content");
    expect(scroll?.getAttribute("data-axis")).toBe("y");
    expect(scroll?.classList.contains("min-h-0")).toBe(true);
    expect(scroll?.classList.contains("flex-1")).toBe(true);
    expect(form.parentElement?.getAttribute("data-slot")).toBe("scroll-plate");
    expect(form.parentElement?.classList.contains("px-panel")).toBe(true);
    expect(scroll?.parentElement).toBe(dialog);
    expect(form.classList.contains("gap-stack")).toBe(true);
    const actions = dialog.querySelector(`[data-slot="${footer}"]`);
    expect(scroll?.nextElementSibling).toBe(actions);
    expect(scroll?.previousElementSibling?.getAttribute("data-slot")).toMatch(
      /-header$/,
    );
    for (const name of ["shrink-0", "border-t", "bg-card"]) {
      expect(actions?.classList.contains(name), name).toBe(true);
    }
    expect(actions?.classList.contains("sticky")).toBe(false);
    expect(actions?.classList.contains("border-border")).toBe(true);
    if (Component === FormSheet) {
      expect(dialog.getAttribute("data-side")).toBe("right");
      expect(dialog.getAttribute("data-slot")).toBe("form-sheet");
    } else {
      expect(dialog.getAttribute("data-slot")).toBe("form-dialog");
      expect(dialog.classList.contains("h-[calc(100dvh-2rem)]")).toBe(true);
    }
  });
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
