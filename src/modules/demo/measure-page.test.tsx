import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { newId } from "@/lib/id";
import { jobEvent, sample, setupDemo } from "./demo.test-support";

test("captures versions across pages and submits only once after review; watches and cancels mine", async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    ...sample,
    id: `id-${i}`,
    code: `B-${i}`,
    rowVersion: i + 1,
  }));
  const { calls, state, container, router } = setupDemo(
    "/demo/measure",
    undefined,
    rows,
  );
  state.job.id = newId();
  const first = await screen.findByRole("checkbox", { name: /B-0$/ });
  fireEvent.click(first);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /B-20$/ }));
  expect(calls.mock.calls.some(([name]) => name === "demo_measure_start")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(container.querySelector('[data-slot="wizard-page"]')).toBeTruthy();
  await screen.findByRole("table", { name: "复核数量与版本" });
  const submit = screen.getByRole("button", { name: "提交测量任务" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/demo/jobs/${state.job.id}`),
  );
  expect(
    calls.mock.calls.filter(([name]) => name === "demo_measure_start"),
  ).toEqual([
    [
      "demo_measure_start",
      {
        input: {
          samples: [
            { id: "id-0", rowVersion: 1 },
            { id: "id-20", rowVersion: 21 },
          ],
        },
      },
    ],
  ]);
  await screen.findByRole("button", { name: "取消任务" });
  expect(calls).toHaveBeenCalledWith("app_job_mine_get", {
    input: { id: state.job.id },
  });
  await jobEvent(state, {
    type: "progress",
    current: 1,
    total: 2,
    messageKey: "demo.progress.measure",
    params: { current: "1", total: "2" },
  });
  await screen.findByText("已处理 1 / 2 张练习卡");
  fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_job_mine_cancel", {
      input: { id: state.job.id },
    }),
  );
  state.job.status = "cancelled";
  state.job.progress = {
    current: 1,
    total: 2,
    messageKey: "demo.progress.measure",
    params: { current: "1", total: "2" },
  };
  await jobEvent(state, { type: "cancelled" });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "正在取消" })).toBeNull(),
  );
  expect(
    calls.mock.calls.some(([name]) => name.startsWith("devtools_job_")),
  ).toBe(false);
});
