import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { currentUser } from "@/core/core.test-support";
import type { JobListInput } from "@/lib/generated/JobListInput";
import {
  firstId,
  fixtureJobKind,
  ipcError,
  jobDetail,
  renderDevtoolsPage,
  setupJobs,
} from "./devtools.test-support";

vi.mock("@/lib/generated/job-kinds", () => ({
  JOB_KINDS: ["devtools.test_task"],
}));

async function selectValue(label: string, option: string) {
  fireEvent.pointerDown(await screen.findByRole("combobox", { name: label }), {
    button: 0,
    pointerType: "mouse",
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

test.each([
  [currentUser.id, "本机所有者"],
  [null, "系统"],
] as const)("列表与详情显示提交者 %s：%s", async (submittedBy, label) => {
  const { state } = setupJobs();
  state.detail.submittedBy = submittedBy;
  const view = renderDevtoolsPage("/devtools/jobs");
  const table = within(await screen.findByRole("table", { name: "任务管理" }));
  expect(await table.findByRole("cell", { name: label })).toBeTruthy();
  view.unmount();
  renderDevtoolsPage(`/devtools/jobs/${firstId}`);
  const submitter = await screen.findByText("提交者");
  expect(submitter.nextElementSibling).toHaveProperty("textContent", label);
});

test("任务列表分页，组合筛选重置页码，清空筛选恢复所有任务", async () => {
  const { calls } = setupJobs((command, payload) => {
    if (command === "devtools_job_list") {
      const { input } = payload as { input: JobListInput };
      return {
        items: [jobDetail()],
        page: input.page,
        pageSize: input.pageSize,
        total: 41,
      };
    }
  });
  renderDevtoolsPage("/devtools/jobs");
  const table = within(await screen.findByRole("table", { name: "任务管理" }));
  expect(
    (await table.findByRole("link", { name: "测试任务" })).getAttribute("href"),
  ).toBe(`/devtools/jobs/${firstId}`);
  expect(
    table.getAllByRole("columnheader").map((header) => header.textContent),
  ).toEqual(["任务类型", "状态", "任务进度", "提交者", "提交时间"]);
  expect(table.queryByRole("button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("第 2 / 3 页，共 41 个任务");
  await selectValue("状态", "已失败");
  await selectValue("任务类型", "测试任务");
  await waitFor(() =>
    expect(calls).toHaveBeenLastCalledWith("devtools_job_list", {
      input: { page: 1, pageSize: 20, status: "failed", kind: fixtureJobKind },
    }),
  );
  await selectValue("状态", "全部");
  await selectValue("任务类型", "全部");
  await waitFor(() =>
    expect(calls).toHaveBeenLastCalledWith("devtools_job_list", {
      input: { page: 1, pageSize: 20 },
    }),
  );
});

test("刷新期间保留行，失败后可重试", async () => {
  const page = { items: [jobDetail()], page: 1, pageSize: 20, total: 1 };
  let resolveFirst!: (value: typeof page) => void;
  let rejectRefresh!: (error: unknown) => void;
  const first = new Promise<typeof page>((resolve) => {
    resolveFirst = resolve;
  });
  const refresh = new Promise<typeof page>((_resolve, reject) => {
    rejectRefresh = reject;
  });
  let requests = 0;
  setupJobs((command) => {
    if (command === "devtools_job_list") {
      requests += 1;
      return requests === 1 ? first : requests === 2 ? refresh : page;
    }
  });
  const { client } = renderDevtoolsPage("/devtools/jobs");
  const table = await screen.findByRole("table", { name: "任务管理" });
  const region = screen.getByRole("region", { name: "任务管理" });
  expect(region.getAttribute("aria-busy")).toBe("true");
  expect(within(table).queryByRole("rowheader")).toBeNull();
  await act(async () => {
    resolveFirst(page);
  });
  await within(table).findByRole("rowheader", { name: "测试任务" });
  await act(async () => {
    void client.invalidateQueries({ queryKey: ["devtools", "jobs"] });
  });
  await waitFor(() => expect(region.getAttribute("aria-busy")).toBe("true"));
  expect(
    within(table).getByRole("rowheader", { name: "测试任务" }),
  ).toBeTruthy();
  await act(async () => {
    rejectRefresh(ipcError());
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "devtools-test",
  );
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await within(table).findByRole("rowheader", { name: "测试任务" });
  expect(requests).toBe(3);
});

test("空列表与筛选无结果保留表格语义", async () => {
  setupJobs((command) =>
    command === "devtools_job_list"
      ? { items: [], page: 1, pageSize: 20, total: 0 }
      : undefined,
  );
  renderDevtoolsPage("/devtools/jobs");
  await screen.findByText("没有匹配的任务。");
  expect(screen.getByRole("button", { name: "上一页" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "下一页" })).toHaveProperty(
    "disabled",
    true,
  );
  await selectValue("状态", "已失败");
  expect(await screen.findByText("没有匹配的结果")).toBeTruthy();
});
