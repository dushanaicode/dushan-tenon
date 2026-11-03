import "../core.test-support";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { JobProgress } from "./job-progress";

it.each([3, null])("任务进度 %s 保留原生元素、数值与文案", (current) => {
  const { container } = render(
    <JobProgress
      status="running"
      progress={{ current, total: 10, messageKey: "kit.loading", params: {} }}
    />,
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root.dataset.slot).toBe("job-progress");
  const bar = screen.getByRole("progressbar");
  expect([
    bar.tagName,
    bar.className,
    bar.getAttribute("max"),
    bar.getAttribute("value"),
  ]).toEqual(["PROGRESS", "h-2 w-full", "10", current === null ? null : "3"]);
  expect(bar.dataset.part).toBe("indicator");
  expect(root.querySelector('[data-part="value"]')?.textContent).toBe(
    current === null ? "尚无进度" : "3 / 10",
  );
  expect(root.querySelector('[data-part="description"]')?.textContent).toBe(
    "加载中",
  );
  expect(Array.from(root.children, (node) => node.tagName)).toEqual([
    "PROGRESS",
    "P",
    "P",
  ]);
});

it.each([null, 0])("无总量 %s 保留单段未知文案，终态仍不渲染", (total) => {
  const progress = { current: null, total, messageKey: null, params: {} };
  const { container, rerender } = render(
    <JobProgress status="queued" progress={progress} />,
  );
  const description = container.firstElementChild as HTMLElement;
  expect(description.tagName).toBe("P");
  expect(description.dataset.slot).toBe("job-progress");
  expect(description.dataset.part).toBe("description");
  expect(screen.queryByRole("progressbar")).toBeNull();
  rerender(<JobProgress status="succeeded" progress={progress} />);
  expect(container.children).toHaveLength(0);
});
