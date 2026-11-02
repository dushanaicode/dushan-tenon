import {
  cleanup,
  fireEvent,
  render as renderView,
  screen,
} from "@testing-library/react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
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
  Checkbox,
  EmptyState,
  ErrorView,
  FormField,
  FormSection,
  Input,
  PageHeader,
  Select,
  SelectTrigger,
  SelectValue,
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

describe("FormField", () => {
  it("集中关联标签、说明、错误和必填状态，移除文案后不留悬空引用", () => {
    const { rerender } = render(
      <FormField label="名称" description="公开显示" error="请填写" required>
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const input = screen.getByLabelText("名称*");
    const description = screen.getByText("公开显示");
    const error = screen.getByRole("alert");
    expect(input).toBe(screen.getByRole("textbox", { name: "名称" }));
    expect(input.getAttribute("aria-describedby")).toBe(
      `${description.id} ${error.id}`,
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(error.textContent).toBe("请填写");
    expect(error.classList.contains("text-destructive")).toBe(true);
    expect(screen.getByText("*").getAttribute("aria-hidden")).toBe("true");
    expect(
      input.closest('[data-slot="form-field"]')?.getAttribute("data-invalid"),
    ).toBe("true");
    const id = input.id;

    rerender(
      <FormField label="名称" description="公开显示">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    expect(input.id).toBe(id);
    expect(input.getAttribute("aria-describedby")).toBe(description.id);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-required")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <FormField label="名称" error="请填写">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByRole("alert").id,
    );
    rerender(
      <FormField label="名称">{(control) => <Input {...control} />}</FormField>,
    );
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("Select 将关联属性展开到触发器", () => {
    render(
      <FormField label="城市" description="选择城市" error="请选择" required>
        {(control) => (
          <Select>
            <SelectTrigger {...control}>
              <SelectValue placeholder="城市" />
            </SelectTrigger>
          </Select>
        )}
      </FormField>,
    );
    const trigger = screen.getByLabelText("城市*");
    expect(trigger).toBe(screen.getByRole("combobox", { name: "城市" }));
    expect(trigger.getAttribute("aria-describedby")).toBe(
      `${screen.getByText("选择城市").id} ${screen.getByRole("alert").id}`,
    );
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-required")).toBe("true");
  });

  it("横排控件在标签之前，点击标签仍能操作控件", () => {
    render(
      <FormField label="桌面通知" orientation="horizontal">
        {(control) => <Checkbox {...control} />}
      </FormField>,
    );
    const checkbox = screen.getByLabelText("桌面通知");
    const label = screen.getByText("桌面通知");
    expect(checkbox.nextElementSibling).toBe(label);
    expect(label.getAttribute("for")).toBe(checkbox.id);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(label);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
  });
});

it("FormSection 使用 fieldset/legend 并关联可选说明", () => {
  const { rerender } = render(
    <FormSection title="个人资料" description="修改公开信息">
      <Input aria-label="名称" />
    </FormSection>,
  );
  const section = screen.getByRole("group", { name: "个人资料" });
  expect(section.tagName).toBe("FIELDSET");
  expect(screen.getByText("个人资料").tagName).toBe("LEGEND");
  expect(section.getAttribute("aria-describedby")).toBe(
    screen.getByText("修改公开信息").id,
  );
  expect(section.contains(screen.getByLabelText("名称"))).toBe(true);
  rerender(<FormSection title="个人资料">内容</FormSection>);
  expect(section.hasAttribute("aria-describedby")).toBe(false);
});

it("PageHeader 保留 h1、说明、前置内容和操作", () => {
  render(
    <PageHeader
      title="用户"
      description="管理用户"
      leading={<Button>返回</Button>}
      actions={<Button>新增</Button>}
    />,
  );
  const header = screen.getByRole("banner");
  for (const element of [
    screen.getByRole("heading", { level: 1, name: "用户" }),
    screen.getByText("管理用户"),
    screen.getByRole("button", { name: "返回" }),
    screen.getByRole("button", { name: "新增" }),
  ]) {
    expect(header.contains(element)).toBe(true);
  }
});

it("EmptyState 展示图标、标题、说明和操作，自身没有播报角色", () => {
  const { container } = render(
    <EmptyState
      icon={Inbox}
      title="暂无记录"
      description="创建第一条记录"
      action={<Button>创建</Button>}
    />,
  );
  expect(screen.getByText("暂无记录")).toBeTruthy();
  expect(screen.getByText("创建第一条记录")).toBeTruthy();
  expect(screen.getByRole("button", { name: "创建" })).toBeTruthy();
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  expect(container.firstElementChild?.hasAttribute("role")).toBe(false);
});

describe("ErrorView", () => {
  it("播报错误，支持重试并在重试期间禁用按钮", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ErrorView message="加载失败" detail="trace-123" onRetry={onRetry} />,
    );
    expect(screen.getByRole("alert").textContent).toContain("加载失败");
    expect(screen.getByRole("heading", { name: "出错了" })).toBeTruthy();
    expect(screen.getByText("trace-123").classList.contains("break-all")).toBe(
      true,
    );
    const retry = screen.getByRole("button", { name: "重试" });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<ErrorView message="加载失败" onRetry={onRetry} retrying />);
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.getAttribute("data-kit")).toBe("button");
    expect(retry.children).toHaveLength(1);
    expect(retry.firstElementChild?.getAttribute("data-part")).toBe("face");
    expect(retry.querySelector('[data-slot="spinner"]')).not.toBeNull();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("支持调用方文案，无 onRetry 时不显示按钮", () => {
    const { rerender } = render(
      <ErrorView
        title="无法连接"
        message="加载失败"
        retryLabel="重新连接"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "无法连接" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeTruthy();
    rerender(<ErrorView message="加载失败" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const i18n = createKitTestI18n();
function render(ui: ReactNode) {
  return renderView(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}
