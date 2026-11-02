import { expect, it } from "vitest";
import {
  ancestors,
  atRules,
  cssFiles,
  declarations,
  findRule,
  loadCss,
  readCss,
  rules,
} from "./styles.test-support";

const scroll = loadCss("scroll-area.css");
const base = loadCss("base.css");
const navigation = loadCss("navigation.css");
const command = loadCss("command.css");
const desktop = loadCss("desktop.css");
const area = '[data-kit="scroll-area"]';
const content = `${area}[data-region="content"]`;
const auxiliary = `${area}[data-region="auxiliary"]`;

it.each([
  ["y", { "overflow-y": "auto", "overflow-x": "clip" }],
  ["x", { "overflow-x": "auto", "overflow-y": "clip" }],
  ["both", { overflow: "auto" }],
])("ScrollArea %s 轴只提供一个滚动端口", (axis, expected) => {
  expect(declarations(findRule(scroll, area))).toEqual({
    "min-height": "0",
    "min-width": "0",
  });
  expect(
    declarations(findRule(scroll, `${area}[data-axis="${axis}"]`)),
  ).toEqual(expected);
});

it("内容滚动槽稳定，鼠标、键盘焦点和滚动中均可见", () => {
  expect(declarations(findRule(scroll, content))).toMatchObject({
    "scrollbar-gutter": "stable",
    "scrollbar-width": "thin",
    "scrollbar-color": "transparent transparent",
  });
  expect(
    declarations(
      findRule(
        scroll,
        `${content}:is(:hover, :focus-within, [data-scrolling])`,
      ),
    ),
  ).toEqual({ "scrollbar-color": "var(--scrollbar-thumb) transparent" });
});

it("内容板保持 paint containment，不引入第二层 overflow 或固定高度", () => {
  // 仅检查单滚动端口的 CSS 前提；sticky 像素位置需要真实布局引擎验证。
  expect(
    declarations(findRule(scroll, `${content} > [data-slot="scroll-plate"]`)),
  ).toEqual({ contain: "paint", "min-height": "100%" });
});

it("辅助区仅在溢出时遮罩四条边，Textarea 不新增滚动元素", () => {
  const values = declarations(findRule(scroll, auxiliary));
  expect(values["scrollbar-width"]).toBe("none");
  expect(values).not.toHaveProperty("mask-image");
  const masked = findRule(
    scroll,
    `${auxiliary}:is([data-scroll-start~="x"], [data-scroll-end~="x"], [data-scroll-start~="y"], [data-scroll-end~="y"])`,
  );
  expect(declarations(masked)["mask-composite"]).toBe("intersect");
  for (const axis of ["x", "y"]) {
    for (const edge of ["start", "end"]) {
      expect(values[`--scroll-area-${axis}-${edge}`]).toBe("0px");
      expect(
        declarations(
          findRule(scroll, `${area}[data-scroll-${edge}~="${axis}"]`),
        ),
      ).toEqual({ [`--scroll-area-${axis}-${edge}`]: "16px" });
    }
  }
  expect(declarations(findRule(scroll, '[data-slot="textarea"]'))).toEqual({
    "overflow-y": "auto",
    "scrollbar-width": "none",
  });
});

it("强制色彩在无障碍层恢复全部滚动条并取消遮罩", () => {
  const media = atRules(scroll, "media")[0];
  expect(media.params).toBe("(forced-colors: active)");
  expect(media.parent).toMatchObject({
    name: "layer",
    params: "appearance-a11y",
  });
  const selector = `:is(${area}, [data-slot="textarea"], [data-radix-select-viewport])`;
  expect(declarations(findRule(media, selector))).toEqual({
    "scrollbar-width": "auto",
    "scrollbar-color": "auto",
    "mask-image": "none",
  });
  expect(
    declarations(findRule(media, `${selector}::-webkit-scrollbar`)),
  ).toEqual({ display: "block" });
});

it("文档本身不成为滚动端口，同时保留浮层滚动锁和 Select 边界", () => {
  expect(declarations(findRule(base, "html, body"))).toEqual({
    overflow: "clip",
  });
  expect(declarations(findRule(base, "body[data-scroll-locked]"))).toEqual({
    overflow: "hidden",
  });
  expect(declarations(findRule(base, "[data-radix-select-viewport]"))).toEqual({
    "scrollbar-width": "none",
  });
  expect(
    declarations(
      findRule(base, "[data-radix-select-viewport]::-webkit-scrollbar"),
    ),
  ).toEqual({ display: "none" });
});

it("设置行在 720px 容器内分栏，控件宽度有最大边界", () => {
  const container = atRules(base, "container")[0];
  expect(container.params).toBe("(min-width: 720px)");
  expect(declarations(findRule(container, ".kit-setting-row"))).toMatchObject({
    display: "grid",
    "grid-template-columns": "minmax(0, 1fr) minmax(0, 1fr)",
  });
  expect(
    declarations(
      findRule(
        container,
        '[data-part="setting-control"] > [data-slot="select-trigger"]',
      ),
    ),
  ).toEqual({ width: "14rem", "max-width": "100%" });
  expect(
    declarations(
      findRule(
        container,
        '[data-part="setting-control"] [data-slot="number-input"]',
      ),
    ),
  ).toEqual({ width: "8rem", "max-width": "100%" });
  expect(
    declarations(findRule(base, '[data-part="setting-rows"] > * + *'))[
      "border-top"
    ],
  ).toBe("1px solid var(--border)");
});

it("首尾可见内容继承圆角，进度填充限制在轨道内", () => {
  const edges = rules(base).filter((rule) =>
    rule.selector.startsWith(".kit-edge-stack"),
  );
  expect(edges).toHaveLength(2);
  expect(declarations(edges[0])).toEqual({
    "border-top-left-radius": "inherit",
    "border-top-right-radius": "inherit",
  });
  expect(declarations(edges[1])).toEqual({
    "border-bottom-left-radius": "inherit",
    "border-bottom-right-radius": "inherit",
  });
  for (const edge of edges)
    expect(edge.selector).toContain(
      ':not([hidden], [aria-hidden="true"], .sr-only)',
    );
  expect(declarations(findRule(base, '[data-slot="progress"]'))).toEqual({
    overflow: "clip",
  });
});

it("焦点环高于工具类，表格与设置组采用内缩焦点避免裁切", () => {
  const focus = findRule(base, ":focus-visible");
  expect(focus.parent).toMatchObject({
    name: "layer",
    params: "appearance-defaults",
  });
  expect(declarations(focus)).toMatchObject({
    outline: "2px solid var(--ring)",
    "outline-offset": "2px",
  });
  const inset = rules(base).find((rule) =>
    rule.selector.includes('[data-part="table-scroll"]'),
  );
  expect(inset).toBeDefined();
  if (!inset) throw new Error("Missing inset focus");
  expect(declarations(inset)["outline-offset"]).toBe("-3px");
});

it("分组标签不交互，导航保留选中、父子缩进和折叠箭头", () => {
  expect(
    declarations(findRule(navigation, '[data-part="nav-group-label"]')),
  ).toMatchObject({
    "pointer-events": "none",
    "user-select": "none",
    background: "none",
    color: "var(--muted-foreground)",
  });
  expect(
    declarations(
      findRule(navigation, '[data-shell="nav-item"][aria-current="page"]'),
    ),
  ).toMatchObject({
    background: "var(--sidebar-accent)",
    color: "var(--sidebar-accent-foreground)",
  });
  expect(
    declarations(findRule(navigation, '[data-part="nav-children"]'))[
      "border-inline-start"
    ],
  ).toBe("1px solid var(--sidebar-border)");
  expect(
    declarations(findRule(navigation, '[data-part="nav-arrow"]')).transition,
  ).toBe("rotate var(--motion-fast) var(--ease-standard)");
  expect(
    declarations(
      findRule(
        navigation,
        '[data-nav-kind="parent"][data-state="closed"] [data-part="nav-arrow"]',
      ),
    ).rotate,
  ).toBe("-90deg");
});

it("抽屉、窄菜单和粗指针有 44px 触摸目标，强制色彩仍标识当前页", () => {
  const touch = findRule(
    navigation,
    '[data-kit="sheet"] [data-shell="nav-item"], [data-shell="nav-flyout"][data-nav-narrow="true"] [data-shell="nav-item"]',
  );
  expect(declarations(touch)["min-height"]).toBe("44px");
  expect(touch.parent).toMatchObject({
    name: "layer",
    params: "appearance-a11y",
  });
  const media = atRules(navigation, "media");
  expect(media.map((rule) => rule.params)).toEqual([
    "(pointer: coarse)",
    "(forced-colors: active)",
  ]);
  expect(
    declarations(
      findRule(media[1], '[data-shell="nav-item"][aria-current="page"]'),
    ),
  ).toMatchObject({
    outline: "2px solid Highlight",
    background: "Canvas",
    color: "CanvasText",
  });
});

it("CommandDialog 受视口限制，列表沿用 ScrollArea 的滚动端口", () => {
  expect(
    declarations(findRule(command, "[data-command-dialog]")),
  ).toMatchObject({
    "max-width": "36rem",
    "max-height": "calc(100dvh - 64px)",
    background: "var(--popover)",
    "box-shadow": "var(--elev-popover)",
  });
  const list = declarations(
    findRule(command, '[data-command-dialog] [data-slot="command-list"]'),
  );
  expect(list).toMatchObject({
    "min-height": "0",
    "max-height": "24rem",
    "overscroll-behavior": "contain",
  });
  expect(list).not.toHaveProperty("overflow");
});

it("cmdk 选中样式只命中 data-disabled=false，不把属性存在当作禁用", () => {
  const rule = findRule(
    command,
    '[data-command-dialog] [data-slot="command-item"][data-disabled="false"][data-selected="true"]',
  );
  const dialog = document.createElement("div");
  dialog.setAttribute("data-command-dialog", "");
  const item = document.createElement("div");
  item.dataset.slot = "command-item";
  item.dataset.disabled = "false";
  item.dataset.selected = "true";
  dialog.append(item);
  expect(item.matches(rule.selector)).toBe(true);
  item.dataset.disabled = "true";
  expect(item.matches(rule.selector)).toBe(false);
  expect(declarations(rule)).toMatchObject({
    background: "var(--accent)",
    color: "var(--accent-foreground)",
    "border-color": "var(--ring)",
  });
});

it("CommandDialog 搜索框整体承载焦点，强制色彩保留键盘选中轮廓", () => {
  const wrapper =
    '[data-command-dialog] [data-slot="command-input-wrapper"]:has(:focus-visible)';
  expect(declarations(findRule(command, wrapper)).outline).toBe(
    "2px solid var(--ring)",
  );
  const forced = atRules(command, "media")[0];
  expect(forced.params).toBe("(forced-colors: active)");
  expect(declarations(findRule(forced, wrapper)).outline).toBe(
    "3px solid Highlight",
  );
  expect(
    declarations(
      findRule(
        forced,
        '[data-command-dialog] [data-slot="command-item"][data-disabled="false"][data-selected="true"]',
      ),
    ).outline,
  ).toBe("2px solid Highlight");
});

it("拖拽、交互排除和 mac 标题栏规则仅在系统层声明一次", () => {
  const regions = cssFiles().flatMap((name) =>
    rules(loadCss(name)).filter((rule) =>
      Object.hasOwn(declarations(rule), "app-region"),
    ),
  );
  expect(regions).toHaveLength(2);
  expect(declarations(regions[0])).toEqual({
    "app-region": "drag",
    "--window-drag-allowed": "1",
  });
  expect(declarations(regions[1])).toEqual({
    "app-region": "no-drag",
    "--window-drag-allowed": "0",
  });
  for (const rule of rules(desktop)) {
    expect(rule.parent).toMatchObject({
      name: "layer",
      params: "appearance-system",
    });
    expect(rule.nodes.some((node) => node.important)).toBe(false);
  }
  expect(
    declarations(
      findRule(
        desktop,
        'html[data-mac-titlebar="overlay"] [data-shell="root"]',
      ),
    ),
  ).toEqual({ "padding-top": "28px" });
  expect(
    declarations(
      findRule(
        desktop,
        'html[data-mac-titlebar="overlay"] [data-window-drag] :is(:disabled, [aria-disabled="true"], [data-disabled])',
      ),
    ),
  ).toEqual({ "pointer-events": "auto" });
});

it.each([
  "<button disabled>Disabled</button>",
  "<input disabled>",
  '<div contenteditable="true">Editable</div>',
  '<div role="separator" tabindex="-1">Resize</div>',
  "<div data-separator>Resize</div>",
  "<span data-window-no-drag>No drag</span>",
])("拖拽区域排除可交互几何：%s", (html) => {
  const region = document.createElement("header");
  region.dataset.windowDrag = "";
  region.innerHTML = html;
  const noDrag = rules(desktop).find(
    (rule) => declarations(rule)["app-region"] === "no-drag",
  );
  if (!noDrag) throw new Error("Missing no-drag rule");
  // happy-dom 不接受 :is() 内的换行；只规范空白，不解开层或模拟级联。
  const selector = noDrag.selector
    .replace(/\s+/g, " ")
    .replaceAll("( ", "(")
    .replaceAll(" )", ")");
  expect(region.firstElementChild?.matches(selector)).toBe(true);
});

it("StreamText 保留供应商静态样式和受限表格、代码排版", () => {
  const stream = loadCss("stream.css");
  expect(atRules(stream, "import")[0].params).toBe(
    '"streamdown/styles.css" layer(components)',
  );
  expect(declarations(findRule(stream, ".kit-stream-text"))).toMatchObject({
    "overflow-wrap": "anywhere",
    color: "var(--foreground)",
  });
  expect(declarations(findRule(stream, ".kit-stream-text pre"))).toMatchObject({
    "white-space": "pre",
    "overflow-wrap": "normal",
  });
  expect(declarations(findRule(stream, ".kit-stream-table"))).toEqual({
    "max-width": "100%",
    "max-height": "25rem",
  });
  for (const rule of rules(stream))
    expect(ancestors(rule)).toContainEqual(
      expect.objectContaining({ name: "layer", params: "components" }),
    );
  expect(readCss("stream.css")).not.toContain("@keyframes");
});
