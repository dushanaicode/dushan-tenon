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
import { expect, test, vi } from "vitest";
import { BreadcrumbExample } from "./examples/breadcrumb";
import source0 from "./examples/navigation-tree.tsx?raw";
import { PaginationExample } from "./examples/pagination";
import { StepperExample } from "./examples/stepper";
import { TabsExample } from "./examples/tabs";
import "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import catalog from "./catalog/navigation.json";
import { NavigationPage, navigationExamples } from "./pages/navigation-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
test("navigation renders retained kit patterns and exposes their matching DEV source", async () => {
  const view = render(
    <MemoryRouter>
      <NavigationPage />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  for (const [index, example] of navigationExamples.entries()) {
    expect(example.file).toBe(catalog[index].exampleFile);
    expect((await example.load?.())?.default).toBe(
      readFileSync(example.file, "utf8"),
    );
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(5),
  );
  expect(
    screen.getByRole("navigation", {
      name: i18n.t("showcase.navigation.sampleNav"),
    }),
  ).toBeTruthy();
});

test("breadcrumb parents are text, tabs are keyboard accessible and page/step bounds disable movement", async () => {
  const view = render(
    <>
      <BreadcrumbExample />
      <TabsExample />
      <PaginationExample />
      <StepperExample />
    </>,
  );
  const crumb = screen.getByRole("navigation", { name: "示例面包屑" });
  expect(within(crumb).queryByRole("link")).toBeNull();
  expect(crumb.querySelector('[aria-current="page"]')?.textContent).toBe(
    "草稿",
  );
  const summary = screen.getByRole("tab", { name: "摘要" });
  act(() => summary.focus());
  fireEvent.keyDown(summary, { key: "ArrowRight" });
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "历史" }).getAttribute("aria-selected"),
    ).toBe("true"),
  );
  expect(screen.getByRole("tab", { name: "未开放" })).toHaveProperty(
    "disabled",
    true,
  );
  const pages = within(screen.getByRole("navigation", { name: "分页" }));
  expect(pages.getByRole("button", { name: "上一页" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(pages.getByRole("button", { name: "下一页" }));
  expect(screen.getByRole("status").textContent).toContain("2 / 3");
  fireEvent.click(pages.getByRole("button", { name: "下一页" }));
  expect(pages.getByRole("button", { name: "下一页" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(
    view.container.querySelector('[aria-current="step"]')?.textContent,
  ).toContain("核对");
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByRole("button", { name: "下一步" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("the copyable navigation source uses only ordinary router APIs", () => {
  expect(source0).not.toMatch(/UNSAFE_|MemoryRouter|\bas\s+(?:never|any)\b/);
});
