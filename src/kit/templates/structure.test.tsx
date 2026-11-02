import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { ConversationPage } from "./conversation-page";
import { DashboardPage } from "./dashboard-page";
import { DetailPage } from "./detail-page";
import { FormDialog, FormSheet } from "./form-container";
import { ListPage } from "./list-page";
import { MasterDetail } from "./master-detail";
import { StatusPage } from "./status-page";
import { WizardPage } from "./wizard-page";

it.each([FormDialog, FormSheet])(
  "$name 派生 slot 保留内容基类和标题/说明",
  async (Component) => {
    const { container } = renderKit(
      <Component
        open
        onOpenChange={vi.fn()}
        title="表单"
        description="填写说明"
        onSubmit={vi.fn()}
      >
        <p>内容</p>
      </Component>,
    );
    const content = await screen.findByRole("dialog", { name: "表单" });
    const kind = Component === FormDialog ? "dialog" : "sheet";
    expect(content.dataset.kit).toBe(kind);
    expect(content.dataset.slot).toBe(`form-${kind}`);
    expect(
      content.querySelector(`[data-slot="${kind}-title"]`)?.textContent,
    ).toBe("表单");
    expect(
      content.querySelector(`[data-slot="${kind}-description"]`)?.textContent,
    ).toBe("填写说明");
    expect(
      content.querySelector('[data-slot="form-container-body"]')?.tagName,
    ).toBe("FORM");
    expect(container.contains(content)).toBe(false);
  },
);

it("页面模板继承标题部件，已有结构 slot 与分页落点仍可定位", () => {
  const { container } = renderKit(
    <>
      <DashboardPage
        title="概览"
        description="统计说明"
        stats={[{ id: "total", title: "数量", value: 7 }]}
      />
      <DetailPage
        title="详情"
        onBack={vi.fn()}
        tabs={[{ id: "one", label: "资料", content: "正文" }]}
      />
      <ListPage
        title="列表"
        table={{
          caption: "条目",
          columns: [{ id: "name", header: "名称", cell: (row: string) => row }],
          rows: ["甲"],
          getRowId: (row) => row,
        }}
        pagination={{ page: 1, pageSize: 10, total: 1, onPageChange: vi.fn() }}
      />
      <WizardPage
        title="向导"
        label="导入"
        steps={[{ id: "one", label: "上传", content: "文件" }]}
        current={0}
        onCurrentChange={vi.fn()}
        onFinish={vi.fn()}
      />
      <MasterDetail
        master="主列表"
        detail="详细内容"
        masterLabel="主"
        detailLabel="从"
      />
    </>,
  );
  for (const slot of [
    "dashboard-page",
    "detail-page",
    "list-page",
    "wizard-page",
  ]) {
    const root = container.querySelector(
      `[data-slot="${slot}"]`,
    ) as HTMLElement;
    expect(
      root.querySelector('[data-slot="page-header"] [data-part="title"]')
        ?.tagName,
    ).toBe("H1");
  }
  expect(
    container.querySelector('[data-slot="detail-page"] [data-part="leading"]'),
  ).toBe(screen.getByRole("button", { name: "返回" }));
  for (const slot of [
    "dashboard-page-stats",
    "stat-card-value",
    "list-page-pagination",
    "wizard-page-content",
    "master-detail-master",
    "master-detail-detail",
  ])
    expect(
      container.querySelector(`[data-slot="${slot}"]`),
      slot,
    ).not.toBeNull();
});

it("加载标题与说明保留 status/aria-busy，切换空态后移除忙碌状态", () => {
  const { rerender } = renderKit(
    <StatusPage kind="loading" title="载入" description="请稍候" />,
  );
  const root = screen.getByRole("status");
  expect(root.getAttribute("aria-busy")).toBe("true");
  expect(root.querySelector('[data-part="title"]')?.textContent).toBe("载入");
  expect(root.querySelector('[data-part="description"]')?.textContent).toBe(
    "请稍候",
  );
  rerender(<StatusPage kind="empty" />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("暂无内容")).toBeTruthy();
});

it("ConversationPage 只标已有标题/用量/说明，不拆分消息", () => {
  const { container } = renderKit(
    <ConversationPage
      title="对话"
      messages={[
        {
          id: "one",
          role: "assistant",
          parts: [{ id: "part", type: "text", text: "完整正文" }],
        },
      ]}
      status="succeeded"
      activeMessageId={null}
      inputValue=""
      onInputChange={vi.fn()}
      onSubmit={vi.fn()}
      onStop={vi.fn()}
      usage="12 tokens"
      notice="完成说明"
    />,
  );
  const message = container.querySelector(
    '[data-slot="conversation-message"]',
  ) as HTMLElement;
  expect(message.tagName).toBe("LI");
  expect(message.querySelector('[data-part="title"]')?.tagName).toBe("H2");
  expect(
    message.querySelector('[data-slot="stream-text"]')?.textContent,
  ).toContain("完整正文");
  expect(container.querySelector('[data-part="usage"]')?.textContent).toBe(
    "12 tokens",
  );
  expect(container.querySelector('[data-part="notice"]')?.textContent).toBe(
    "完成说明",
  );
  expect(
    container
      .querySelector('[data-slot="conversation-scroll"]')
      ?.getAttribute("aria-live"),
  ).toBe("off");
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
