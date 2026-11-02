import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { KeyValueList } from "./key-value-list";

const items = [
  { key: "owner", label: "创建者", value: "所有者" },
  {
    key: "file",
    label: <span>关联文件</span>,
    value: <a href="/files">报告文件</a>,
  },
];

it("使用 dl/dt/dd，标签和值支持节点及换行", () => {
  const { container } = render(<KeyValueList items={items} className="mt-2" />);
  const list = container.firstElementChild;
  expect(list?.tagName).toBe("DL");
  expect(list?.getAttribute("data-slot")).toBe("key-value-list");
  expect(list?.classList.contains("mt-2")).toBe(true);
  expect(list?.querySelectorAll("dt")).toHaveLength(2);
  expect(list?.querySelectorAll("dd")).toHaveLength(2);
  expect(screen.getByText("创建者").tagName).toBe("DT");
  expect(screen.getByText("所有者").tagName).toBe("DD");
  const link = screen.getByRole("link", { name: "报告文件" });
  expect(link.closest("dd")?.classList.contains("break-words")).toBe(true);
  const rows = container.querySelectorAll('[data-slot="key-value-item"]');
  for (const item of rows) {
    expect(item.classList.contains("grid-cols-[6rem_1fr]")).toBe(true);
  }
});

it.each([undefined, 1, 2] as const)("columns=%s 控制响应式网格", (columns) => {
  const { container } = render(
    <KeyValueList items={items} columns={columns} />,
  );
  expect(
    container.firstElementChild?.classList.contains("sm:grid-cols-2"),
  ).toBe(columns === 2);
});
