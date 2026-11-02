import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { Timeline, type TimelineItem } from "./timeline";

const items: readonly TimelineItem[] = [
  { id: "queued", title: "等待处理", time: "09:00", description: "已加入队列" },
  { id: "running", title: "处理中", tone: "info" },
  { id: "done", title: "已完成", tone: "success" },
  { id: "slow", title: "响应慢", tone: "warning" },
  { id: "failed", title: <strong>处理失败</strong>, tone: "danger" },
];

it("使用有序列表并渲染标题、时间和说明，状态保留文字", () => {
  render(<Timeline items={items} className="mt-2" />);
  const list = screen.getByRole("list");
  expect(list.tagName).toBe("OL");
  expect(list.getAttribute("data-slot")).toBe("timeline");
  expect(list.classList.contains("mt-2")).toBe(true);
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(5);
  expect(within(rows[0]).getByText("等待处理")).toBeTruthy();
  expect(within(rows[0]).getByText("09:00")).toBeTruthy();
  expect(within(rows[0]).getByText("已加入队列")).toBeTruthy();
  expect(within(rows[4]).getByText("处理失败").tagName).toBe("STRONG");
});

it("每种 tone 使用语义圆点，仅前四项有连接线", () => {
  render(<Timeline items={items} />);
  const rows = screen.getAllByRole("listitem");
  const classes = [
    "bg-muted-foreground",
    "bg-primary",
    "bg-success",
    "bg-warning",
    "bg-destructive",
  ];
  for (const [index, row] of rows.entries()) {
    const dot = row.querySelector('[data-slot="timeline-dot"]');
    expect(dot?.classList.contains(classes[index])).toBe(true);
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    const line = row.querySelector('[data-slot="timeline-connector"]');
    if (index < rows.length - 1) {
      expect(line?.getAttribute("aria-hidden")).toBe("true");
      expect(line?.classList.contains("bg-border")).toBe(true);
    } else {
      expect(line).toBeNull();
    }
  }
});

it("单项没有连接线，空列表不产生条目", () => {
  const { rerender } = render(<Timeline items={[items[0]]} />);
  expect(document.querySelector('[data-slot="timeline-connector"]')).toBeNull();
  rerender(<Timeline items={[]} />);
  expect(screen.queryAllByRole("listitem")).toEqual([]);
});
