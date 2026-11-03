import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import * as original from "../../samples-page";
import { setupShowcase } from "../showcase.test-support";
import { SamplesGuide } from "./samples-guide";

afterEach(() => vi.restoreAllMocks());
test("dictionary and exchange guide precedes the unchanged list and leaves filtering to the original page", async () => {
  const business = vi.spyOn(original, "default");
  const { container, calls } = setupShowcase("/demo/samples", <SamplesGuide />);
  const guide = await screen.findByRole("region", { name: "导览" });
  expect(guide.querySelector("h1")).toBeNull();
  expect(
    within(guide).getByText("ExportButton / ImportDialog · 文件交换"),
  ).toBeTruthy();
  await screen.findByText("CARD-1");
  expect(business).toHaveBeenCalled();
  expect(
    container.querySelectorAll('[data-showcase-block="theme"]'),
  ).toHaveLength(0);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("navigation", { name: "样板库" })).toBeNull();
  expect(
    guide.compareDocumentPosition(
      screen.getByRole("heading", { name: "练习卡列表" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "关键词" }), {
    target: { value: "无匹配" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await screen.findByText("没有匹配的练习卡");
  expect(calls).toHaveBeenCalledWith("demo_sample_list", {
    input: { page: 1, pageSize: 20, keyword: "无匹配" },
  });
});
