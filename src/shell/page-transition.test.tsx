import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { PageTransition } from "./page-transition";

function renderTransition(target: string, start = "/a") {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Link to={target}>跳转</Link>
      <PageTransition>
        <div className="h-full">页面内容</div>
      </PageTransition>
    </MemoryRouter>,
  );
}

it.each([
  ["/settings", "/settings/general", true],
  ["/settings/general", "/settings/appearance", true],
  ["/settings/appearance", "/", false],
  ["/settings/general", "/settings-extra", false],
])(
  "settings navigation does not replay the page transition: %s to %s",
  (start, target, retained) => {
    const { container } = renderTransition(target, start);
    const previous = container.querySelector('[data-slot="page-transition"]');
    const content = screen.getByText("页面内容");
    fireEvent.click(screen.getByRole("link", { name: "跳转" }));
    expect(
      container.querySelector('[data-slot="page-transition"]') === previous,
    ).toBe(retained);
    expect(screen.getByText("页面内容") === content).toBe(retained);
  },
);

it("首次入场保留高度链，路径变化替换包装层并卸载旧子树", () => {
  const { container } = renderTransition("/b");
  const previous = container.querySelector(
    '[data-slot="page-transition"]',
  ) as HTMLElement;
  const content = screen.getByText("页面内容");
  expect(content.parentElement).toBe(previous);
  expect(content.classList.contains("h-full")).toBe(true);
  for (const name of ["kit-enter", "h-full", "min-h-max"]) {
    expect(previous.classList.contains(name)).toBe(true);
  }
  expect(previous.hasAttribute("data-motion-item")).toBe(true);

  fireEvent.click(screen.getByRole("link", { name: "跳转" }));
  const next = container.querySelector(
    '[data-slot="page-transition"]',
  ) as HTMLElement;
  expect(next).not.toBe(previous);
  expect(next.classList.contains("kit-enter")).toBe(true);
  expect(next.hasAttribute("data-motion-item")).toBe(true);
  expect(previous.isConnected).toBe(false);
  expect(content.isConnected).toBe(false);
  expect(screen.getByText("页面内容")).not.toBe(content);
});

it.each(["/a?page=2", "/a#details"])(
  "同一路径跳转到 %s 保留包装层与子树实例",
  (target) => {
    const { container } = renderTransition(target);
    const previous = container.querySelector('[data-slot="page-transition"]');
    const content = screen.getByText("页面内容");

    fireEvent.click(screen.getByRole("link", { name: "跳转" }));
    expect(container.querySelector('[data-slot="page-transition"]')).toBe(
      previous,
    );
    expect(screen.getByText("页面内容")).toBe(content);
    expect(content.isConnected).toBe(true);
  },
);
