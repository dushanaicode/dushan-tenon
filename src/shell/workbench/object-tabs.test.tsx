import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { newId } from "@/lib/id";
import { job, mockShellIpc, renderShell } from "../shell.test-support";

it("关闭失败回滚路由，显式重试后不会重新打开已关闭对象", async () => {
  const second = { ...job, id: newId() };
  let fail = true;
  const { snapshot } = mockShellIpc(
    (name) => {
      if (name === "app_workbench_update" && fail) {
        fail = false;
        return Promise.reject({
          code: "app.workbench.write_failed",
          params: {},
          traceId: "close-test",
        });
      }
    },
    { objects: [job, second], activeObject: job },
  );
  renderShell({}, `/devtools/jobs/${job.id}`);
  fireEvent.click(
    await screen.findByRole("button", { name: `关闭 任务 ${job.id}` }),
  );
  await screen.findByRole("alert");
  await screen.findByRole("heading", { name: `任务 ${job.id}` });
  expect(snapshot().objects).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "重试保存布局" }));
  await screen.findByRole("heading", { name: `任务 ${second.id}` });
  await waitFor(() => expect(snapshot().objects).toEqual([second]));
});
it("键盘聚焦页签不自动激活，Delete 按 ref 关闭相邻页签", async () => {
  const second = { ...job, id: newId() };
  const { snapshot } = mockShellIpc(undefined, {
    objects: [job, second],
    activeObject: job,
  });
  renderShell({}, `/devtools/jobs/${job.id}`);
  const first = await screen.findByRole("tab", { name: `任务 ${job.id}` });
  const next = screen.getByRole("tab", { name: `任务 ${second.id}` });
  next.focus();
  expect(snapshot().activeObject).toEqual(job);
  fireEvent.keyDown(first, { key: "Delete" });
  await screen.findByRole("heading", { name: `任务 ${second.id}` });
  await waitFor(() => expect(snapshot().objects).toEqual([second]));
});
it("达到生成合同的对象上限时保留已保存列表，显示显式错误", async () => {
  const objects = Array.from({ length: 16 }, () => ({ ...job, id: newId() }));
  const { snapshot } = mockShellIpc(undefined, {
    objects,
    activeObject: objects[0],
  });
  renderShell({}, `/devtools/jobs/${job.id}`);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("16");
  expect(snapshot().objects).toEqual(objects);
});
