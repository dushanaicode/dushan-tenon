import { render as renderView, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { compile } from "tailwindcss";
import { beforeEach, expect, it } from "vitest";
import {
  Button,
  Combobox,
  Icon,
  RangeSlider,
  ToggleGroup,
  ToggleGroupItem,
} from "@/kit";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import iconsCss from "../styles/icons.css?raw";
import themeCss from "../styles/theme.css?raw";

// 编译真实组件输出的 Tailwind class；happy-dom 不计算盒尺寸，像素差分交 Chrome。
async function withUtilities(
  container: HTMLElement,
  check: (css: string) => void,
) {
  const candidates = Array.from(container.querySelectorAll("[class]")).flatMap(
    (element) => Array.from(element.classList),
  );
  const compiler = await compile(
    `${themeCss}\n@theme { --spacing: 0.25rem; }\n@tailwind utilities;`,
  );
  const sheet = document.createElement("style");
  sheet.textContent = `${compiler.build(candidates)}\n${iconsCss}`;
  document.head.append(sheet);
  try {
    check(sheet.textContent);
  } finally {
    sheet.remove();
  }
}

it("新选择控件的真实工具类生成系统色与非颜色选中提示，强制色彩可压过主题", async () => {
  const { container } = render(
    <>
      <ToggleGroup type="multiple" value={["one"]}>
        <ToggleGroupItem value="one">选中项</ToggleGroupItem>
      </ToggleGroup>
      <RangeSlider
        value={[20, 80]}
        onValueChange={() => {}}
        thumbLabels={["下限", "上限"]}
      />
    </>,
  );
  await withUtilities(container, (css) => {
    const item = screen.getByRole("button", { name: "选中项" });
    expect(item.dataset.state).toBe("on");
    expect(item.classList.contains("data-[state=on]:outline-2")).toBe(true);
    expect(
      item.classList.contains(
        "forced-colors:data-[state=on]:[forced-color-adjust:preserve-parent-color]",
      ),
    ).toBe(true);
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("background-color: Highlight !important;");
    expect(css).toContain("color: HighlightText !important;");
    expect(css).toContain("background-color: Canvas !important;");
    expect(css).toContain("forced-color-adjust: preserve-parent-color;");
    expect(css).not.toContain("forced-color-adjust: none");
  });
});

it("face 使用真实工具类继承根 gap、对齐，保持伸缩/截断且不建立定位上下文", async () => {
  const { container } = render(
    <Combobox
      options={[{ value: "one", label: "长标签" }]}
      value="one"
      onValueChange={() => {}}
      placeholder="选择"
      searchPlaceholder="搜索"
      emptyText="无结果"
      className="gap-3"
    />,
  );
  await withUtilities(container, (css) => {
    const root = screen.getByRole("combobox");
    const face = root.firstElementChild as HTMLElement;
    const outer = getComputedStyle(root);
    const inner = getComputedStyle(face);
    expect(outer.display).toBe("inline-flex");
    expect(outer.alignItems).toBe("center");
    expect(outer.justifyContent).toBe("space-between");
    expect(inner.display).toBe("inline-flex");
    // happy-dom 不实现这些非默认继承属性的 computed；检查实际生成规则及其 DOM 命中。
    for (const [name, property] of [
      ["[align-items:inherit]", "align-items"],
      ["[justify-content:inherit]", "justify-content"],
      ["gap-[inherit]", "gap"],
    ]) {
      const selector = `.${CSS.escape(name)}`;
      expect(face.matches(selector)).toBe(true);
      expect(css).toContain(`${selector} {\n  ${property}: inherit;\n}`);
    }
    expect(inner.minWidth).toBe("0px");
    expect(inner.flexGrow).toBe("1");
    expect(inner.whiteSpace).toBe(outer.whiteSpace);
    expect(inner.transform).toBe(outer.transform);
    expect(face.className).not.toMatch(/relative|absolute|transform|overflow/);
  });
});

it("overlay 使用 contents，定位与焦点样式留在根；face 变换不传递给根或计数", async () => {
  const { container } = render(
    <Button
      className="relative"
      aria-label="通知"
      overlay={<span className="absolute -right-1 -top-1">12</span>}
    >
      <Icon iconId="home" />
    </Button>,
  );
  await withUtilities(container, () => {
    const root = screen.getByRole("button", { name: "通知" });
    const face = root.firstElementChild as HTMLElement;
    expect(
      [...root.children].map((child) => child.getAttribute("data-part")),
    ).toEqual(["face", "overlay"]);
    const overlay = root.children[1] as HTMLElement;
    const count = screen.getByText("12");
    expect(getComputedStyle(root).position).toBe("relative");
    expect(getComputedStyle(overlay).display).toBe("contents");
    expect(getComputedStyle(count).position).toBe("absolute");
    expect(root.classList.contains("focus-visible:ring-2")).toBe(true);
    const before = getComputedStyle(root).transform;
    face.style.transform = "translateY(1px)";
    expect(getComputedStyle(face).transform).toBe("translateY(1px)");
    expect(getComputedStyle(root).transform).toBe(before);
    expect(getComputedStyle(count).transform).toBe(before);
  });
});

it("长文本 Button 保持换行/断词继承与根高度约束", async () => {
  const { container } = render(
    <Button className="h-auto min-h-control max-w-full whitespace-normal break-words">
      长文本 LongLabelWithoutSpaces
    </Button>,
  );
  await withUtilities(container, () => {
    const root = screen.getByRole("button");
    const face = root.firstElementChild as HTMLElement;
    expect(getComputedStyle(root).whiteSpace).toBe("normal");
    expect(getComputedStyle(face).whiteSpace).toBe("normal");
    expect(getComputedStyle(root).overflowWrap).toBe("break-word");
    // overflow-wrap 是继承属性；当前 DOM 引擎不计算它的继承，face 不覆盖它。
    expect(face.className).not.toMatch(/break-|wrap-/);
    expect(root.classList.contains("h-auto")).toBe(true);
    expect(root.classList.contains("max-w-full")).toBe(true);
  });
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
