import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Button } from "./button";
import { PageHeader, PageHeadingLevelProvider } from "./page-header";

it("默认页头为 h1 并保留标题标记与文字", () => {
  render(<PageHeader title="默认页头" />);
  const title = screen.getByRole("heading", { level: 1, name: "默认页头" });
  expect(title.getAttribute("data-part")).toBe("title");
  expect(title.textContent).toBe("默认页头");
  expect(title.className).toBe("text-2xl font-semibold tracking-tight");
});

it("level=3 只将标题标签降为 h3", () => {
  render(
    <PageHeadingLevelProvider level={3}>
      <PageHeader title={<span>嵌入页头</span>} />
    </PageHeadingLevelProvider>,
  );
  const title = screen.getByRole("heading", { level: 3, name: "嵌入页头" });
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  expect(title.getAttribute("data-part")).toBe("title");
  expect(title.textContent).toBe("嵌入页头");
  expect(title.className).toBe("text-2xl font-semibold tracking-tight");
});

it("嵌套 Provider 采用最近一层且不影响外层页头", () => {
  render(
    <PageHeadingLevelProvider level={2}>
      <PageHeader title="外层页头" />
      <PageHeadingLevelProvider level={4}>
        <PageHeader title="内层页头" />
      </PageHeadingLevelProvider>
      <PageHeader title="后续页头" />
    </PageHeadingLevelProvider>,
  );
  expect(
    screen.getByRole("heading", { level: 2, name: "外层页头" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 4, name: "内层页头" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "后续页头" }),
  ).toBeTruthy();
});

it("标题块保留弹性基准宽度并渲染标题、说明、操作和前置内容", () => {
  const { container } = render(
    <PageHeader
      title="练习卡"
      description="练习卡详情"
      leading={<Button>返回</Button>}
      actions={<Button>编辑</Button>}
    />,
  );
  const titleBlock = container.querySelector('[data-slot="page-header"] > div');
  expect(titleBlock?.classList.contains("sm:flex-[1_1_16rem]")).toBe(true);
  expect(titleBlock?.classList.contains("flex-none")).toBe(true);
  expect(titleBlock?.classList.contains("flex-[1_1_16rem]")).toBe(false);
  expect(titleBlock?.classList.contains("flex-1")).toBe(false);
  for (const element of [
    screen.getByRole("heading", { level: 1, name: "练习卡" }),
    screen.getByText("练习卡详情"),
    screen.getByRole("button", { name: "返回" }),
  ]) {
    expect(titleBlock?.contains(element)).toBe(true);
  }
  const actions = container.querySelector(
    '[data-slot="page-header"] > .ml-auto',
  );
  expect(actions?.contains(screen.getByRole("button", { name: "编辑" }))).toBe(
    true,
  );
});

it("actions 为 null 时不渲染操作容器", () => {
  const { container } = render(<PageHeader title="练习卡" actions={null} />);
  const header = container.querySelector('[data-slot="page-header"]');
  expect(header?.children).toHaveLength(1);
  expect(header?.querySelector(".ml-auto")).toBeNull();
});
