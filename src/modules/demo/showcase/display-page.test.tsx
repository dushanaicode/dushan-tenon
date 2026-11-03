import { readFileSync } from "node:fs";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import "@/core/core.test-support";

import catalog from "./catalog/display.json";
import * as module1 from "./examples/key-value-list";
import source1 from "./examples/key-value-list.tsx?raw";
import * as module2 from "./examples/stat-card";
import source2 from "./examples/stat-card.tsx?raw";
import * as module3 from "./examples/status-badge";
import source3 from "./examples/status-badge.tsx?raw";
import * as module0 from "./examples/timeline";
import source0 from "./examples/timeline.tsx?raw";
import * as module4 from "./examples/virtual-log";
import source4 from "./examples/virtual-log.tsx?raw";
import { DisplayPage, displayExamples } from "./pages/display-page";

vi.mock("@/core/enabled-modules", () => ({ useCanOpen: () => true }));
afterEach(() => vi.restoreAllMocks());

test("seven live blocks use the catalog's exact rendered modules and source bytes", async () => {
  const spies = [
    vi.spyOn(module0, "TimelineExample"),
    vi.spyOn(module1, "KeyValueListExample"),
    vi.spyOn(module2, "StatCardExample"),
    vi.spyOn(module3, "StatusBadgeExample"),
    vi.spyOn(module4, "VirtualLogExample"),
  ];
  const sources = [source0, source1, source2, source3, source4];
  const view = render(
    <MemoryRouter>
      <DisplayPage />
    </MemoryRouter>,
  );
  expect(
    [...view.container.querySelectorAll("[data-showcase-block]")].map((node) =>
      node.getAttribute("data-showcase-block"),
    ),
  ).toEqual(["header", "preview", "matrix", "usage", "selection", "rules"]);
  expect(new Set(catalog.map((entry) => entry.exampleFile))).toEqual(
    new Set(displayExamples.map((example) => example.file)),
  );
  for (const [index, example] of displayExamples.entries()) {
    expect(sources[index]).toBe(readFileSync(example.file, "utf8"));
    expect((await example.load?.())?.default).toBe(sources[index]);
    expect(spies[index]).toHaveBeenCalled();
  }
  await waitFor(() =>
    expect(view.container.querySelectorAll("pre")).toHaveLength(sources.length),
  );
  expect(
    [...view.container.querySelectorAll("pre")].map((node) => node.textContent),
  ).toEqual(sources);
});

test("all views describe the same fictional record with textual status and readable long names", () => {
  const view = render(
    <MemoryRouter>
      <DisplayPage />
    </MemoryRouter>,
  );
  const preview = view.container.querySelector(
    '[data-showcase-block="preview"]',
  ) as HTMLElement;
  expect(
    within(preview).getAllByText("纸月观测计划：包含较长中文名称的虚构记录")
      .length,
  ).toBeGreaterThan(2);
  expect(within(preview).getAllByText("已完成 3 / 4 个分片")).toHaveLength(2);
  expect(
    within(preview).getByRole("progressbar").getAttribute("aria-valuenow"),
  ).toBe("75");
  expect(preview.querySelector("dl")).toBeTruthy();
  expect(preview.querySelector('[data-slot="timeline"]')?.tagName).toBe("OL");
  for (const dot of preview.querySelectorAll('[data-slot="status-dot"]'))
    expect(dot.getAttribute("aria-hidden")).toBe("true");
  expect(
    within(preview).getAllByText("最后一个分片处理中").length,
  ).toBeGreaterThan(1);
  const expand = within(preview).getByRole("button", { name: "展开过程" });
  fireEvent.click(expand);
  expect(expand.getAttribute("aria-expanded")).toBe("true");
  const card = preview.querySelector('[data-slot="card"]') as HTMLElement;
  expect(within(card).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(expand);
  expect(within(card).queryByRole("list")).toBeNull();
});
