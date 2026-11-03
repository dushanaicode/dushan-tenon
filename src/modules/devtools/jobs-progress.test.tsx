import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  firstId,
  fixtureProgressKey,
  renderDevtoolsPage,
  setupJobs,
} from "./devtools.test-support";

describe.each(["/devtools/jobs", `/devtools/jobs/${firstId}`])(
  "%s 进度显示",
  (path) => {
    test.each([
      ["succeeded", 0],
      ["succeeded", null],
      ["failed", 0],
      ["failed", null],
      ["cancelled", 0],
      ["cancelled", null],
      ["needs_review", 0],
      ["needs_review", null],
      ["succeeded", 1000],
      ["failed", 1000],
      ["cancelled", 1000],
      ["needs_review", 1000],
      ["queued", 0],
      ["running", 0],
      ["queued", null],
      ["running", null],
      ["running", 1000],
    ] as const)("状态 %s、总量 %s", async (status, total) => {
      const { state } = setupJobs();
      state.detail.status = status;
      state.detail.progress = {
        current: total === null ? null : total === 0 ? 0 : 500,
        total,
        messageKey: fixtureProgressKey,
        params: { current: "1", total: "2" },
      };
      renderDevtoolsPage(path);
      await screen.findByRole(path === "/devtools/jobs" ? "link" : "heading", {
        name: "测试任务",
      });
      if (total !== null && total > 0) {
        const bar = screen.getByRole("progressbar", { name: "任务进度" });
        expect(bar.getAttribute("value")).toBe("500");
        expect(bar.getAttribute("max")).toBe("1000");
        expect(screen.getByText("500 / 1000")).toBeTruthy();
        expect(screen.queryByText("尚无进度")).toBeNull();
      } else {
        expect(Boolean(screen.queryByText("尚无进度"))).toBe(
          status === "queued" || status === "running",
        );
        expect(screen.queryByRole("progressbar")).toBeNull();
        expect(screen.queryByText("0 / 0")).toBeNull();
      }
      expect(Boolean(screen.queryByText("已处理 1 / 2 项"))).toBe(
        status === "running" && total !== null && total > 0,
      );
    });
  },
);
