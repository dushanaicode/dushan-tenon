import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import {
  PageTitleFocusProvider,
  usePageTitleFocus,
  usePageTitleText,
} from "./page-title-focus";
import { PageHeader, PageHeadingLevelProvider } from "./ui/page-header";

function Focus() {
  const focus = usePageTitleFocus();
  return (
    <button type="button" onClick={focus}>
      聚焦
    </button>
  );
}

function TitleText() {
  return <output data-testid="title-text">{usePageTitleText()}</output>;
}

it("标题文本随原位更新、富文本与卸载同步，并还原登记标记", () => {
  const content = (title: ReactNode) => (
    <PageTitleFocusProvider>
      <TitleText />
      {title !== null && <PageHeader title={title} />}
    </PageTitleFocusProvider>
  );
  const view = render(content("第一页"));
  const heading = screen.getByRole("heading");
  expect(heading.hasAttribute("data-page-title")).toBe(true);
  expect(screen.getByTestId("title-text").textContent).toBe("第一页");
  view.rerender(content("第二页"));
  expect(screen.getByRole("heading")).toBe(heading);
  expect(screen.getByTestId("title-text").textContent).toBe("第二页");
  view.rerender(
    content(
      <span>
        详情 <strong>42</strong>
      </span>,
    ),
  );
  expect(screen.getByTestId("title-text").textContent).toBe("详情 42");
  expect(screen.getByTestId("title-text").querySelector("strong")).toBeNull();
  view.rerender(content(null));
  expect(screen.getByTestId("title-text").textContent).toBe("");
  expect(heading.hasAttribute("data-page-title")).toBe(false);
  expect(heading.hasAttribute("tabindex")).toBe(false);
});
it("登记 h1，切换后使用新标题，并在卸载后等待下一次登记", () => {
  const content = (title: string | null) => (
    <PageTitleFocusProvider>
      <Focus />
      {title && <PageHeader key={title} title={title} />}
    </PageTitleFocusProvider>
  );
  const view = render(content("第一页"));
  fireEvent.click(screen.getByText("聚焦"));
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "第一页" }),
  );
  view.rerender(content("第二页"));
  fireEvent.click(screen.getByText("聚焦"));
  const previous = screen.getByRole("heading", { name: "第二页" });
  expect(document.activeElement).toBe(previous);
  view.rerender(content(null));
  screen.getByText("聚焦").focus();
  fireEvent.click(screen.getByText("聚焦"));
  expect(document.activeElement).not.toBe(previous);
  view.rerender(content("懒页面"));
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "懒页面" }),
  );
});
it("子标题不抢占 h1，最近 Provider 单独登记", () => {
  render(
    <PageTitleFocusProvider>
      <Focus />
      <PageHeader title="正文" />
      <PageHeadingLevelProvider level={2}>
        <PageHeader title="辅助标题" />
      </PageHeadingLevelProvider>
      <PageTitleFocusProvider>
        <PageHeader title="独立区域" />
      </PageTitleFocusProvider>
    </PageTitleFocusProvider>,
  );
  fireEvent.click(screen.getByText("聚焦"));
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "正文" }),
  );
});
it("没有 Provider 时仍可独立显示标题", () => {
  render(<PageHeader title="独立页面" />);
  expect(screen.getByRole("heading").hasAttribute("tabindex")).toBe(false);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "独立页面",
  );
});
