import { render, screen } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb";

// @ts-expect-error 导航地标的名称必须由调用方提供
const unnamed = <Breadcrumb />;
void unnamed;

it("原生语义、当前页与路由 asChild 的真实链接；调用方提供读屏文案", () => {
  const long = "这是完整的中文长路径".repeat(12);
  const { container } = render(
    <MemoryRouter>
      <Breadcrumb aria-label="资源路径">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/library">资源库</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis>更多层级</BreadcrumbEllipsis>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{long}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </MemoryRouter>,
  );
  const nav = screen.getByRole("navigation", { name: "资源路径" });
  expect(nav.dataset).toMatchObject({ kit: "breadcrumb", slot: "breadcrumb" });
  expect(nav.firstElementChild?.tagName).toBe("OL");
  const link = screen.getByRole("link", { name: "资源库" });
  expect(link.getAttribute("href")).toBe("/library");
  expect(link.dataset.slot).toBe("breadcrumb-link");
  expect(link.querySelector("a")).toBeNull();
  const current = screen.getByText(long);
  expect(current.getAttribute("aria-current")).toBe("page");
  expect(current.tagName).toBe("SPAN");
  expect(current.className).toContain("min-w-0");
  expect(current.className).toContain("break-words");
  const separators = container.querySelectorAll(
    '[data-slot="breadcrumb-separator"]',
  );
  expect(separators).toHaveLength(2);
  for (const separator of separators) {
    expect(separator.getAttribute("role")).toBe("presentation");
    expect(separator.getAttribute("aria-hidden")).toBe("true");
    expect(separator.querySelector("svg")).not.toBeNull();
  }
  expect(screen.getByText("更多层级").className).toBe("sr-only");
  expect(
    container.querySelector('[data-slot="breadcrumb-list"]')?.className,
  ).toContain("flex-wrap");
});
