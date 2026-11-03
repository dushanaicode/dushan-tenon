import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import catalog from "./catalog/templates.json";
import { TemplateConversationExample } from "./examples/template-conversation";
import conversationSource from "./examples/template-conversation.tsx?raw";
import { TemplateDashboardExample } from "./examples/template-dashboard";
import dashboardSource from "./examples/template-dashboard.tsx?raw";
import { TemplateDetailExample } from "./examples/template-detail";
import detailSource from "./examples/template-detail.tsx?raw";
import { TemplateFormSheetExample } from "./examples/template-form-sheet";
import formSource from "./examples/template-form-sheet.tsx?raw";
import { TemplateListExample } from "./examples/template-list";
import listSource from "./examples/template-list.tsx?raw";
import { TemplateMasterDetailExample } from "./examples/template-master-detail";
import masterDetailSource from "./examples/template-master-detail.tsx?raw";
import { TemplateSettingsLayoutExample } from "./examples/template-settings-layout";
import settingsSource from "./examples/template-settings-layout.tsx?raw";
import { TemplateStatusExample } from "./examples/template-status";
import statusSource from "./examples/template-status.tsx?raw";
import { TemplateWizardExample } from "./examples/template-wizard";
import wizardSource from "./examples/template-wizard.tsx?raw";
import { TemplatesPage, templatesExamples } from "./pages/templates-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => vi.restoreAllMocks());

test("seven blocks expose the exact nine rendered example files; only the selected template mounts", async () => {
  const spies = [
    vi.spyOn(
      await import("./examples/template-dashboard"),
      "TemplateDashboardExample",
    ),
    vi.spyOn(await import("./examples/template-list"), "TemplateListExample"),
    vi.spyOn(
      await import("./examples/template-master-detail"),
      "TemplateMasterDetailExample",
    ),
    vi.spyOn(
      await import("./examples/template-detail"),
      "TemplateDetailExample",
    ),
    vi.spyOn(
      await import("./examples/template-form-sheet"),
      "TemplateFormSheetExample",
    ),
    vi.spyOn(
      await import("./examples/template-settings-layout"),
      "TemplateSettingsLayoutExample",
    ),
    vi.spyOn(
      await import("./examples/template-wizard"),
      "TemplateWizardExample",
    ),
    vi.spyOn(
      await import("./examples/template-conversation"),
      "TemplateConversationExample",
    ),
    vi.spyOn(
      await import("./examples/template-status"),
      "TemplateStatusExample",
    ),
  ];
  const sources = [
    dashboardSource,
    listSource,
    masterDetailSource,
    detailSource,
    formSource,
    settingsSource,
    wizardSource,
    conversationSource,
    statusSource,
  ];
  const view = render(
    <MemoryRouter>
      <TemplatesPage />
    </MemoryRouter>,
  );
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  expect(catalog).toHaveLength(9);
  expect(catalog.map((entry) => entry.exampleFile)).toEqual(
    templatesExamples.map((example) => example.file),
  );
  for (const [index, example] of templatesExamples.entries()) {
    expect(sources[index]).toBe(readFileSync(example.file, "utf8"));
    expect((await example.load?.())?.default).toBe(sources[index]);
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(9),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
  const tabs = within(
    screen.getByRole("tablist", { name: "选择模板" }),
  ).getAllByRole("tab");
  const preview = screen.getByRole("region", { name: "模板预览容器" });
  for (const [index, tab] of tabs.entries()) {
    if (index > 0) {
      for (const spy of spies) spy.mockClear();
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    }
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(spies[index]).toHaveBeenCalled();
    for (const [otherIndex, spy] of spies.entries()) {
      if (otherIndex !== index) expect(spy).not.toHaveBeenCalled();
    }
    const populated = [
      ...preview.querySelectorAll(':scope > [data-slot="tabs-content"]'),
    ].filter((panel) => panel.childElementCount > 0);
    expect(populated).toHaveLength(1);
    expect(populated[0].getAttribute("aria-labelledby")).toBe(tab.id);
    expect(view.container.querySelectorAll("h1")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "页面模板" }),
    ).toBeTruthy();
    for (const title of preview.querySelectorAll(
      '[data-slot="page-header"] [data-part="title"]',
    ))
      expect(title.tagName).toBe("H3");
    if (catalog[index].id === "template.status-page")
      expect(preview.querySelector("h1, h3")).toBeNull();
  }
});

test("T6 is a new composition, retains no draft after unmount, and the outer tabs are keyboard accessible", async () => {
  render(
    <MemoryRouter>
      <TemplatesPage />
    </MemoryRouter>,
  );
  const tablist = screen.getByRole("tablist", { name: "选择模板" });
  const settings = within(tablist).getByRole("tab", { name: "T6 设置组合" });
  fireEvent.mouseDown(settings, { button: 0, ctrlKey: false });
  const preview = screen.getByRole("region", { name: "模板预览容器" });
  expect(within(preview).getByText("设置表单组合示例")).toBeTruthy();
  expect(
    within(preview).getByText(/当前没有可导入的 SettingsPage 内核导出/),
  ).toBeTruthy();
  expect(preview.textContent).not.toContain("已有模板");
  expect(
    catalog.find((entry) => entry.id === "pattern.settings-layout")?.kind,
  ).toBe("pattern");
  fireEvent.change(within(preview).getByRole("textbox"), {
    target: { value: "只属于当前挂载的虚构草稿" },
  });
  const dashboard = within(tablist).getByRole("tab", { name: "T1 看板" });
  fireEvent.mouseDown(dashboard, { button: 0, ctrlKey: false });
  expect(within(preview).queryByRole("textbox")).toBeNull();
  fireEvent.mouseDown(settings, { button: 0, ctrlKey: false });
  expect(within(preview).getByRole("textbox")).toHaveProperty(
    "value",
    "纸月观测计划",
  );
  act(() => settings.focus());
  fireEvent.keyDown(settings, { key: "ArrowRight" });
  const wizard = within(tablist).getByRole("tab", { name: "T7 向导" });
  await waitFor(() =>
    expect(wizard.getAttribute("aria-selected")).toBe("true"),
  );
  expect(document.activeElement).toBe(wizard);
  expect(
    within(preview).getByRole("button", { name: "下一步" }),
  ).toHaveProperty("disabled", true);
});

test("dashboard completion changes actual summary and disables the completed action", () => {
  render(<TemplateDashboardExample />);
  const finish = screen.getByRole("button", { name: "完成最后分片" });
  fireEvent.click(finish);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "100",
  );
  expect(screen.getByText("全部分片已完成")).toBeTruthy();
  expect(finish).toHaveProperty("disabled", true);
});

test("list template filters and resets pagination", () => {
  render(<TemplateListExample />);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("蓝砂整理计划")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "纸月" } });
  fireEvent.submit(screen.getByRole("search"));
  expect(screen.getByText("纸月观测计划")).toBeTruthy();
  expect(screen.getByRole("button", { name: "上一页" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("master-detail changes the selected object and offers a narrow-screen way back", () => {
  const view = render(<TemplateMasterDetailExample />);
  fireEvent.click(screen.getByRole("button", { name: "蓝砂整理计划" }));
  const detail = screen.getByRole("region", { name: "计划详情" });
  expect(within(detail).getByText("蓝砂整理计划")).toBeTruthy();
  expect(detail.classList.contains("hidden")).toBe(false);
  fireEvent.click(within(detail).getByRole("button", { name: "返回主列表" }));
  expect(detail.classList.contains("hidden")).toBe(true);
  expect(
    view.container
      .querySelector('[data-slot="master-detail-master"]')
      ?.classList.contains("hidden"),
  ).toBe(false);
});

test("detail tabs switch from attributes to a real timeline", () => {
  const view = render(<TemplateDetailExample />);
  expect(
    view.container.querySelector('[data-slot="key-value-list"]'),
  ).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "过程" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(view.container.querySelector('[data-slot="timeline"]')).toBeTruthy();
  expect(
    view.container.querySelector('[data-slot="key-value-list"]'),
  ).toBeNull();
});

test.each(["打开表单侧滑", "打开表单对话框"])(
  "%s submits the actual form and returns focus",
  async (name) => {
    render(<TemplateFormSheetExample />);
    const trigger = screen.getByRole("button", { name });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "编辑虚构计划" });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "虚构表单草稿" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存计划" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("虚构表单草稿");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  },
);

test("T6 honestly labels its composition and local draft becomes unsaved when changed", () => {
  render(<TemplateSettingsLayoutExample />);
  expect(
    screen.getByText(/当前没有可导入的 SettingsPage 内核导出/),
  ).toBeTruthy();
  expect(
    screen.getByText(i18n.t("showcase.templates.newExample")),
  ).toBeTruthy();
  const save = screen.getByRole("button", { name: "提交本页演示草稿" });
  fireEvent.click(save);
  expect(save).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("switch", { name: "显示计划摘要" }));
  expect(save).toHaveProperty("disabled", false);
  expect(screen.getByRole("status").textContent).toBe("尚未提交演示草稿");
});

test("wizard enforces required input, keeps it when going back and completes", () => {
  render(<TemplateWizardExample />);
  const next = screen.getByRole("button", { name: "下一步" });
  expect(next).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "虚构向导计划" },
  });
  fireEvent.click(next);
  expect(screen.getByText("将建立虚构计划：虚构向导计划")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "上一步" }));
  expect(screen.getByRole("textbox")).toHaveProperty("value", "虚构向导计划");
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  fireEvent.click(screen.getByRole("button", { name: "建立计划" }));
  expect(screen.getByRole("status").textContent).toBe("虚构计划已在本页建立");
});

test("conversation is controlled, protects IME and appends only its fixed fictional reply", () => {
  const view = render(<TemplateConversationExample />);
  const input = screen.getByRole("textbox", { name: "消息" });
  fireEvent.change(input, { target: { value: "虚构用户消息" } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(
    view.container.querySelectorAll('[data-slot="conversation-message"]'),
  ).toHaveLength(1);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveProperty("value", "");
  expect(
    view.container.querySelectorAll('[data-slot="conversation-message"]'),
  ).toHaveLength(3);
  expect(screen.getByText(/这是固定的虚构回复/)).toBeTruthy();
});

test("status template switches all five shapes and retry restores healthy empty data", () => {
  const view = render(<TemplateStatusExample />);
  fireEvent.click(screen.getByRole("button", { name: "失败" }));
  expect(screen.getByRole("alert").textContent).toContain("本地失败场景");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "无权限" }));
  expect(view.container.querySelector('[data-slot="empty"]')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "未找到" }));
  expect(view.container.querySelector('[data-slot="empty"]')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "加载中" }));
  expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy();
});
