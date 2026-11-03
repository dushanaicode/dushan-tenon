import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { assert, expect, test, vi } from "vitest";
import { currentUser } from "@/core/core.test-support";
import type { DemoDraftLease } from "@/lib/generated/DemoDraftLease";
import type { FileIngressSnapshot } from "@/lib/generated/FileIngressSnapshot";
import { newId } from "@/lib/id";
import { jobEvent, sample, setupDemo } from "./demo.test-support";

async function choose(label: string, value: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: label }), {
    button: 0,
    pointerType: "mouse",
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("option", { name: value }));
}

test("sample list restores applied filters, page, master-detail mode and scroll after leaving", async () => {
  const rows = Array.from({ length: 45 }, (_, index) => ({
    ...sample,
    id: newId(),
    code: `SESSION-${index}`,
    stage: "ready" as const,
  }));
  const f = setupDemo("/demo/samples", undefined, rows);
  await screen.findByRole("link", { name: "SESSION-0" });
  fireEvent.change(screen.getByRole("textbox", { name: "关键词" }), {
    target: { value: "SESSION-" },
  });
  await choose("状态", "已测量");
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("demo_sample_list", {
      input: { page: 1, pageSize: 20, keyword: "SESSION-", stage: "ready" },
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
  await screen.findByRole("link", { name: "SESSION-20" });
  fireEvent.click(screen.getByRole("button", { name: "主从视图" }));
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  fireEvent.scroll(screen.getAllByRole("region", { name: "练习卡列表" })[0], {
    target: { scrollTop: 480 },
  });
  await act(async () => f.router.navigate("/"));
  await act(async () => f.router.navigate("/demo/samples"));
  await screen.findByRole("link", { name: "SESSION-20" });
  expect(screen.getByRole("textbox", { name: "关键词" })).toHaveProperty(
    "value",
    "SESSION-",
  );
  expect(screen.getByRole("combobox", { name: "状态" }).textContent).toContain(
    "已测量",
  );
  expect(
    screen
      .getByRole("button", { name: "主从视图" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await waitFor(() =>
    expect(
      screen.getAllByRole("region", { name: "练习卡列表" })[0].scrollTop,
    ).toBe(480),
  );
});

test("create and server validation", async () => {
  let invalid = true;
  const fixture = setupDemo("/demo/samples", (command, payload) => {
    if (command === "demo_draft_commit") {
      if (invalid)
        return Promise.reject({
          code: "demo.sample.code_conflict",
          params: {},
          traceId: "create-trace",
        });
      const input = (payload as { input: DemoDraftLease }).input;
      const draft = [...fixture.state.drafts.values()].find(
        (draft) => draft.lease.id === input.id,
      );
      assert(draft);
      const created = {
        ...sample,
        ...draft.fields,
        id: "created",
        rowVersion: 1,
      };
      fixture.state.rows.push(created);
      return created;
    }
  });
  await screen.findByRole("table", { name: "练习卡列表" });
  expect(
    fixture.container.querySelector('[data-slot="list-page"]'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "创建练习卡" }));
  const form = within(
    await screen.findByRole("dialog", { name: "创建练习卡" }),
  );
  fireEvent.change(await form.findByRole("textbox", { name: "编号" }), {
    target: { value: "NEW" },
  });
  fireEvent.change(form.getByRole("textbox", { name: "标题" }), {
    target: { value: "新练习卡" },
  });
  fireEvent.change(form.getByRole("textbox", { name: "备注" }), {
    target: { value: "🌍" },
  });
  fireEvent.click(form.getByRole("button", { name: "保存练习卡" }));
  await form.findByText(/create-trace/);
  expect(
    (form.getByRole("textbox", { name: "标题" }) as HTMLInputElement).value,
  ).toBe("新练习卡");
  invalid = false;
  fireEvent.click(form.getByRole("button", { name: "保存练习卡" }));
  await screen.findByRole("link", { name: "NEW" });
  expect(screen.queryByRole("dialog", { name: "创建练习卡" })).toBeNull();
  expect(fixture.calls).toHaveBeenCalledWith("demo_draft_write", {
    input: {
      lease: expect.objectContaining({ revision: 0 }),
      fields: { code: "NEW", title: "新练习卡", note: "🌍" },
    },
  });
});

test("incoming CSV requires a target and import confirmation, reusing the picked-file token", async () => {
  const inbox: FileIngressSnapshot = {
    pending: [
      { type: "file", id: "first", name: "incoming.csv", extension: "csv" },
    ],
    recent: [],
    issue: null,
    skippedDirectories: 0,
  };
  const f = setupDemo("/", (command) => {
    if (command === "app_file_ingress_list") return structuredClone(inbox);
    if (command === "app_file_ingress_claim") {
      inbox.pending = [];
      return {
        token: "external-token",
        fileName: "incoming.csv",
        format: "csv",
      };
    }
  });
  const pending = within(
    await screen.findByRole("dialog", { name: "打开文件" }),
  );
  expect(
    f.calls.mock.calls.some(
      ([command]) =>
        command === "app_file_ingress_claim" ||
        command === "demo_sample_import",
    ),
  ).toBe(false);
  fireEvent.click(
    await pending.findByRole("button", { name: /交给\s*练习卡列表/ }),
  );
  const importer = within(await screen.findByRole("dialog", { name: "导入" }));
  await importer.findByText("incoming.csv");
  expect(f.router.state.location.pathname).toBe("/demo/samples");
  expect(
    f.calls.mock.calls.some(([command]) => command === "demo_sample_import"),
  ).toBe(false);
  fireEvent.click(importer.getByRole("button", { name: "开始导入" }));
  await waitFor(() =>
    expect(f.calls).toHaveBeenCalledWith("demo_sample_import", {
      input: { fileToken: "external-token", mode: "error" },
    }),
  );
  expect(
    f.calls.mock.calls.some(([command]) => command === "app_file_pick"),
  ).toBe(false);
});

test("real filters, pagination and export share matching criteria; import reports row errors", async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    ...sample,
    id: `id-${i}`,
    code: `B-${i}`,
    stage: "ready" as const,
  }));
  const { calls, state } = setupDemo("/demo/samples", undefined, rows);
  await screen.findByRole("link", { name: "B-0" });
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("link", { name: "B-20" });
  expect(calls).toHaveBeenCalledWith("demo_sample_list", {
    input: { page: 2, pageSize: 20 },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "关键词" }), {
    target: { value: "B-" },
  });
  await choose("状态", "已测量");
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("demo_sample_list", {
      input: { page: 1, pageSize: 20, keyword: "B-", stage: "ready" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("demo_sample_export", {
      input: {
        fileToken: "picked-token",
        format: "xlsx",
        keyword: "B-",
        stage: "ready",
      },
    }),
  );
  state.job.status = "succeeded";
  state.job.result = { rows: 21, fileName: "samples.xlsx" };
  await jobEvent(state, { type: "succeeded", data: null });
  await screen.findByText("已导出 21 行：samples.xlsx");
  expect(
    screen.getByRole("link", { name: "job-1" }).getAttribute("href"),
  ).toContain("/demo/jobs/job-1");
  fireEvent.click(screen.getByRole("button", { name: "导入" }));
  const dialog = within(screen.getByRole("dialog", { name: "导入" }));
  expect(dialog.queryByRole("button", { name: "下载模板" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "选择导入文件" }));
  await dialog.findByText("sample.txt");
  await choose("已存在数据的处理方式", "跳过");
  state.job.id = "import-job";
  state.job.status = "queued";
  state.job.result = null;
  fireEvent.click(dialog.getByRole("button", { name: "开始导入" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("demo_sample_import", {
      input: { fileToken: "picked-token", mode: "skip" },
    }),
  );
  state.job.status = "failed";
  state.job.result = {
    total: 1,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [
      { row: 2, column: "title", code: "app.input.invalid", params: {} },
    ],
    errorsTruncated: false,
  };
  await waitFor(() => expect(state.channels).toHaveLength(2));
  await jobEvent(state, {
    type: "failed",
    code: "app.input.invalid",
    params: {},
  });
  const table = await dialog.findByRole("table", { name: "行错误" });
  expect(within(table).getByText("标题")).toBeTruthy();
  expect(
    calls.mock.calls.some(([name]) => name.endsWith("_import_template")),
  ).toBe(false);
});

test("shares one list query and selected ID; narrow screens open the detail route", async () => {
  let wide = true;
  const media = Object.assign(new EventTarget(), {
    matches: false,
    media: "",
  }) as MediaQueryList;
  vi.mocked(window.matchMedia).mockImplementation((query) =>
    query === "(min-width: 768px)"
      ? (Object.assign(new EventTarget(), {
          matches: wide,
          media: query,
        }) as MediaQueryList)
      : media,
  );
  const { calls, router, container } = setupDemo("/demo/samples");
  await screen.findByRole("link", { name: "CARD-1" });
  fireEvent.click(screen.getByRole("button", { name: "主从视图" }));
  const before = calls.mock.calls.filter(
    ([name]) => name === "demo_sample_list",
  ).length;
  fireEvent.click(screen.getByRole("link", { name: "CARD-1" }));
  await screen.findByRole("heading", { name: "真实练习卡" });
  expect(container.querySelector('[data-slot="master-detail"]')).toBeTruthy();
  expect(container.querySelector('[data-slot="detail-page"]')).toBeTruthy();
  expect(router.state.location.pathname).toBe("/demo/samples");
  expect(
    calls.mock.calls.filter(([name]) => name === "demo_sample_list"),
  ).toHaveLength(before);
  expect(calls).toHaveBeenCalledWith("demo_sample_get", {
    input: { id: sample.id },
  });
  wide = false;
  fireEvent.click(screen.getByRole("link", { name: "CARD-1" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/demo/samples/${sample.id}`),
  );
});

test("empty and no-match are real list results and export respects an empty filter", async () => {
  const { calls, state } = setupDemo("/demo/samples", undefined, []);
  await screen.findByText("尚无练习卡");
  fireEvent.change(screen.getByRole("textbox", { name: "关键词" }), {
    target: { value: "missing" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await screen.findByText("没有匹配的练习卡");
  state.file = null;
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  await waitFor(() =>
    expect(calls.mock.calls.some(([name]) => name === "app_file_pick")).toBe(
      true,
    ),
  );
  expect(calls.mock.calls.some(([name]) => name === "demo_sample_export")).toBe(
    false,
  );
});

test("read-only samples expose no writes, import or export controls", async () => {
  setupDemo("/demo/samples", (command) =>
    command === "account_auth_status"
      ? {
          mode: "none",
          state: "active",
          user: currentUser,
          permissions: ["demo.sample.read"],
          idleLockMinutes: 15,
        }
      : undefined,
  );
  await screen.findByRole("link", { name: "CARD-1" });
  for (const name of ["创建练习卡", "导出", "导入"])
    expect(screen.queryByRole("button", { name })).toBeNull();
});

test("switching to master/detail preserves the applied keyword and filtering", async () => {
  setupDemo("/demo/samples");
  await screen.findByRole("link", { name: "CARD-1" });
  fireEvent.change(screen.getByRole("textbox", { name: "关键词" }), {
    target: { value: "CARD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "搜索" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "主从视图" }));
  expect(
    (screen.getByRole("textbox", { name: "关键词" }) as HTMLInputElement).value,
  ).toBe("CARD");
  expect(screen.getByRole("link", { name: "CARD-1" })).toBeTruthy();
});
