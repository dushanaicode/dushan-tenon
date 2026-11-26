import { expect, it } from "vitest";
import {
  ancestors,
  atRules,
  declarations,
  findRule,
  loadCss,
  rules,
  tokensFor,
} from "./styles.test-support";

const sheet = loadCss("motion.css");
const keyframes = atRules(sheet, "keyframes");
const frame = (name: string, selector: string) => {
  const animation = keyframes.find((rule) => rule.params === name);
  if (!animation) throw new Error(`Missing animation: ${name}`);
  return declarations(findRule(animation, selector));
};

it("基础动效的时长、缓动与关键帧固定在默认层", () => {
  expect(tokensFor("light")).toMatchObject({
    "--motion-fast": "120ms",
    "--motion-base": "200ms",
    "--motion-slow": "320ms",
    "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
  });
  expect(keyframes.map((rule) => rule.params)).toEqual([
    "kit-enter",
    "kit-exit",
    "kit-fade-in",
    "kit-fade-out",
    "kit-slide-in",
    "kit-slide-out",
    "kit-collapse-in",
    "kit-collapse-out",
    "kit-spin",
    "kit-pulse",
  ]);
  for (const rule of keyframes)
    expect(rule.parent).toMatchObject({
      name: "layer",
      params: "appearance-defaults",
    });
});

it("浮层含 Tooltip 三种打开状态，退出与遮罩使用相反关键帧", () => {
  expect(
    declarations(
      findRule(
        sheet,
        '.kit-pop:is([data-state="open"], [data-state="delayed-open"], [data-state="instant-open"])',
      ),
    ).animation,
  ).toBe("kit-enter var(--motion-base) var(--ease-standard) both");
  for (const [selector, animation, duration] of [
    ['.kit-pop[data-state="closed"]', "kit-exit", "fast"],
    ['.kit-overlay[data-state="open"]', "kit-fade-in", "base"],
    ['.kit-overlay[data-state="closed"]', "kit-fade-out", "fast"],
    ['.kit-slide[data-state="open"]', "kit-slide-in", "base"],
    ['.kit-slide[data-state="closed"]', "kit-slide-out", "fast"],
  ])
    expect(declarations(findRule(sheet, selector)).animation).toBe(
      `${animation} var(--motion-${duration}) var(--ease-standard) both`,
    );
  expect(frame("kit-enter", "from")).toEqual(frame("kit-exit", "to"));
  expect(frame("kit-enter", "to")).toEqual(frame("kit-exit", "from"));
  expect(frame("kit-fade-in", "from")).toEqual({ opacity: "0" });
  expect(frame("kit-fade-out", "to")).toEqual({ opacity: "0" });
});

it.each([
  ["right", "6px", "0px"],
  ["left", "-6px", "0px"],
  ["top", "0px", "-6px"],
  ["bottom", "0px", "6px"],
])("Sheet %s 方向仅改变固定偏移的轴和正负", (side, dx, dy) => {
  expect(
    declarations(findRule(sheet, `.kit-slide[data-side="${side}"]`)),
  ).toEqual({ "--kit-dx": dx, "--kit-dy": dy });
  expect(frame("kit-slide-in", "from").transform).toBe(
    "translate(var(--kit-dx), var(--kit-dy))",
  );
  expect(frame("kit-slide-out", "to")).toEqual(frame("kit-slide-in", "from"));
});

it("Accordion/Collapsible 使用组件提供的测量高度", () => {
  expect(frame("kit-collapse-in", "from")).toEqual({ height: "0" });
  expect(frame("kit-collapse-in", "to")).toEqual({
    height: "var(--kit-content-height)",
  });
  expect(frame("kit-collapse-out", "from")).toEqual(
    frame("kit-collapse-in", "to"),
  );
  expect(frame("kit-collapse-out", "to")).toEqual({ height: "0" });
  expect(
    declarations(findRule(sheet, '.kit-collapse[data-state="open"]')).animation,
  ).toBe("kit-collapse-in var(--motion-base) var(--ease-standard) both");
  expect(
    declarations(findRule(sheet, '.kit-collapse[data-state="closed"]'))
      .animation,
  ).toBe("kit-collapse-out var(--motion-fast) var(--ease-standard) both");
});

it("Spinner 旋转，Skeleton、状态与未知进度只改变透明度", () => {
  expect(declarations(findRule(sheet, ".kit-spin")).animation).toBe(
    "kit-spin 1s linear infinite",
  );
  expect(declarations(findRule(sheet, ".kit-pulse")).animation).toBe(
    "kit-pulse calc(var(--motion-slow) * 5) ease-in-out infinite",
  );
  expect(frame("kit-spin", "from")).toEqual({ transform: "rotate(0deg)" });
  expect(frame("kit-spin", "to")).toEqual({ transform: "rotate(360deg)" });
  expect(frame("kit-pulse", "from")).toEqual({ opacity: "1" });
  expect(frame("kit-pulse", "50%")).toEqual({ opacity: "0.5" });
  expect(frame("kit-pulse", "to")).toEqual({ opacity: "1" });
});

it("表格首批数据只淡入，不依赖索引或 stagger", () => {
  expect(declarations(findRule(sheet, ".kit-enter"))).toEqual({
    animation: "kit-fade-in var(--motion-base) var(--ease-standard) both",
  });
});

it("系统减动无条件停止元素、伪元素和供应商动画，无恢复分支", () => {
  const media = atRules(sheet, "media");
  expect(media).toHaveLength(1);
  expect(media[0].params).toBe("(prefers-reduced-motion: reduce)");
  expect(ancestors(media[0])).toContainEqual(
    expect.objectContaining({ name: "layer", params: "appearance-a11y" }),
  );
  const reduced = findRule(media[0], "*, ::before, ::after");
  expect(declarations(reduced)).toEqual({
    animation: "none",
    transition: "none",
    "scroll-behavior": "auto",
  });
  expect(
    reduced.nodes
      .filter((node) => node.type === "decl")
      .every((node) => node.important),
  ).toBe(true);
  for (const rule of rules(sheet)) {
    for (const [property, value] of Object.entries(declarations(rule))) {
      if (property === "transition" || property === "transition-property")
        expect(value).not.toContain("all");
    }
  }
});

it("外观设置关闭动效时与系统减动一样全部静止", () => {
  const off = findRule(
    sheet,
    ':root[data-motion="off"] *, :root[data-motion="off"] ::before, :root[data-motion="off"] ::after',
  );
  expect(ancestors(off)).toContainEqual(
    expect.objectContaining({ name: "layer", params: "appearance-a11y" }),
  );
  expect(declarations(off)).toEqual({
    animation: "none",
    transition: "none",
    "scroll-behavior": "auto",
  });
  expect(
    off.nodes
      .filter((node) => node.type === "decl")
      .every((node) => node.important),
  ).toBe(true);
});
