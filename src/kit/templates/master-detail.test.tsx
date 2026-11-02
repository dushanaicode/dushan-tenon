import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { MasterDetail } from "./master-detail";

it.each([undefined, false, true])(
  "showDetail=%s 用 CSS 控制窄窗口，宽窗口保持两个区域",
  (showDetail) => {
    const { container } = renderKit(
      <MasterDetail
        master={<p>会话列表</p>}
        detail={<p>会话内容</p>}
        masterLabel="会话"
        detailLabel="当前会话详情"
        showDetail={showDetail}
        className="mt-2"
      />,
    );
    const root = container.firstElementChild;
    expect(root?.getAttribute("data-slot")).toBe("master-detail");
    for (const name of ["grid", "h-full", "min-h-0", "mt-2"]) {
      expect(root?.classList.contains(name), name).toBe(true);
    }
    expect(
      root?.classList.contains("@medium/content:grid-cols-[18rem_1fr]"),
    ).toBe(true);
    const master = screen.getByRole("region", { name: "会话" });
    const detail = screen.getByRole("region", { name: "当前会话详情" });
    expect(master.textContent).toBe("会话列表");
    expect(detail.textContent).toBe("会话内容");
    for (const region of [master, detail]) {
      expect(region.dataset.kit).toBe("scroll-area");
      expect(region.classList.contains("min-h-0")).toBe(true);
      expect(region.dataset.axis).toBe("y");
    }
    expect(master.dataset.region).toBe("auxiliary");
    expect(detail.dataset.region).toBe("content");
    expect(detail.firstElementChild?.getAttribute("data-slot")).toBe(
      "scroll-plate",
    );
    expect(master.classList.contains("@medium/content:border-r")).toBe(true);
    expect(master.classList.contains("@medium/content:border-border")).toBe(
      true,
    );
    expect(master.classList.contains("hidden")).toBe(showDetail === true);
    expect(detail.classList.contains("hidden")).toBe(showDetail !== true);
    const narrowHidden = showDetail ? master : detail;
    const narrowVisible = showDetail ? detail : master;
    expect(narrowHidden.classList.contains("@medium/content:block")).toBe(true);
    expect(narrowVisible.classList.contains("block")).toBe(true);
    expect(container.querySelector("main")).toBeNull();
  },
);

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
