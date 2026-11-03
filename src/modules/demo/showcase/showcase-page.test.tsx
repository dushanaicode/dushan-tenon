import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { i18n } from "@/core/i18n";
import "@/core/core.test-support";
import { PageHeader } from "@/kit";
import { AiQuickCard } from "./ai-quick-card";
import catalog from "./catalog/buttons.json";
import { ShowcasePage } from "./showcase-page";
import { UsagePanel } from "./usage-panel";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));

test("seven fixed blocks in order, real matrix collapse, related links and catalog hints", () => {
  const { container } = render(
    <MemoryRouter>
      <ShowcasePage
        id="buttons"
        preview={<button type="button">真实预览</button>}
        matrix={<p>矩阵内容</p>}
        entries={catalog}
        examples={[]}
      />
    </MemoryRouter>,
  );
  expect(
    [...container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  const header = container.querySelector('[data-showcase-block="header"]');
  expect(header?.classList.contains("rounded-lg")).toBe(true);
  expect(header?.classList.contains("p-4")).toBe(true);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "按钮与动作",
  );
  expect(
    screen.getByRole("link", { name: "开关与选择" }).getAttribute("href"),
  ).toBe("/demo/choices");

  const toggle = screen.getByRole("button", { name: "状态矩阵" });
  fireEvent.click(toggle);
  expect(screen.queryByText("矩阵内容")).toBeNull();
  expect(screen.getByRole("button", { name: "真实预览" })).toBeTruthy();
  fireEvent.click(toggle);
  expect(screen.getByText("矩阵内容")).toBeTruthy();
  expect(screen.getByText(catalog[0].id)).toBeTruthy();
});

test("preview and matrix page headers are h3 under their h2 blocks, with one page h1", () => {
  const { container } = render(
    <MemoryRouter>
      <ShowcasePage
        id="buttons"
        preview={<PageHeader title="预览页头" />}
        matrix={<PageHeader title="矩阵页头" />}
        entries={catalog}
        examples={[]}
      />
    </MemoryRouter>,
  );
  expect(container.querySelectorAll("h1")).toHaveLength(1);
  expect(
    screen.getByRole("heading", { level: 1, name: "按钮与动作" }),
  ).toBeTruthy();
  for (const [block, title] of [
    ["preview", "预览页头"],
    ["matrix", "矩阵页头"],
  ]) {
    const heading = screen.getByRole("heading", { level: 3, name: title });
    expect(heading.getAttribute("data-part")).toBe("title");
    expect(heading.closest(`[data-showcase-block="${block}"]`)).toBeTruthy();
  }
});

test.each(["zh-CN", "en-US"])(
  "AI quick card renders all twelve rules in order in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    render(<AiQuickCard entries={catalog} />);
    const summary = screen.getByText(i18n.t("showcase.common.allRules"));
    fireEvent.click(summary);
    const items = within(summary.parentElement as HTMLElement).getAllByRole(
      "listitem",
      { hidden: true },
    );
    const ids = Array.from(
      { length: 12 },
      (_, i) => `SC-R${String(i + 1).padStart(2, "0")}`,
    );
    expect(items.map((item) => item.textContent)).toEqual(
      ids.map((id) => `${id} · ${i18n.t(`showcase.common.rules.${id}`)}`),
    );
  },
);

test("production source panel is absent", () => {
  vi.stubEnv("DEV", false);
  const load = vi.fn();
  const { container } = render(
    <UsagePanel examples={[{ file: "example.tsx", load }]} />,
  );
  expect(container.childElementCount).toBe(0);
  expect(load).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

test.each(["reject", "missing"])(
  "clipboard %s provides the exact source as read-only fallback",
  async (failure) => {
    const source = "// showcase-example\nexport function Example() {}\n";
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(
      failure === "missing"
        ? (undefined as unknown as Clipboard)
        : ({ writeText } as unknown as Clipboard),
    );
    const view = render(
      <UsagePanel
        examples={[
          { file: "example.tsx", load: async () => ({ default: source }) },
        ]}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "复制最小示例" }),
    );
    const fallback = await screen.findByRole("textbox", {
      name: "可复制的示例原文",
    });
    expect(fallback).toHaveProperty("readOnly", true);
    expect(fallback).toHaveProperty("value", source);
    expect(view.container.querySelector("pre")?.textContent).toBe(source);
    if (failure === "reject") expect(writeText).toHaveBeenCalledWith(source);
    vi.restoreAllMocks();
  },
);

test("copy reports success only after clipboard completion; load failures remain visible", async () => {
  let complete = () => {};
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
    writeText,
  } as unknown as Clipboard);
  const view = render(
    <UsagePanel
      examples={[
        { file: "ok.tsx", load: async () => ({ default: "source" }) },
        {
          file: "failed.tsx",
          load: async () => {
            throw new Error("chunk failed");
          },
        },
      ]}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "复制最小示例" }));
  expect(screen.queryByText("示例已复制。")).toBeNull();
  await act(async () => complete());
  expect(screen.getByText("示例已复制。")).toBeTruthy();
  expect(within(view.container).getByRole("alert").textContent).toContain(
    "加载失败",
  );
  vi.restoreAllMocks();
});
