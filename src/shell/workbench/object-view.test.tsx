import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PageHeader } from "@/kit";
import {
  job,
  manifest,
  mockShellIpc,
  renderShell,
  visibility,
} from "../shell.test-support";

it("Console 路由打开对象并保存公共状态；页签关闭后回到正文", async () => {
  const { snapshot } = mockShellIpc();
  renderShell({}, `/devtools/jobs/${job.id}`);
  await screen.findByRole("heading", { name: `任务 ${job.id}` });
  await waitFor(() => expect(snapshot().activeObject).toEqual(job));
  expect(snapshot().objects).toEqual([job]);
  const close = screen.getByRole("button", { name: `关闭 任务 ${job.id}` });
  fireEvent.click(close);
  await waitFor(() => expect(snapshot().objects).toEqual([]));
  await screen.findByRole("heading", { name: "/" });
});
it("恢复时丢弃不可达对象；不调用受限贡献的 resolver 或懒工厂", async () => {
  const resolve = vi.fn(manifest.workbenchObjects[0].resolve);
  const Component = vi.fn(async () => ({
    default: () => <PageHeader title="不应加载" />,
  }));
  const { snapshot } = mockShellIpc(undefined, {
    objects: [job],
    activeObject: job,
  });
  renderShell({
    auth: { ...visibility, permissions: [] },
    manifests: [
      {
        ...manifest,
        workbenchObjects: [
          { ...manifest.workbenchObjects[0], resolve, Component },
        ],
      },
    ],
  });
  await screen.findByRole("heading", { name: "/" });
  await waitFor(() => expect(snapshot().objects).toEqual([]));
  expect(resolve).not.toHaveBeenCalled();
  expect(Component).not.toHaveBeenCalled();
});
it("对象加载失败保留持久状态，显式重试后恢复", async () => {
  const resolve = vi
    .fn(manifest.workbenchObjects[0].resolve)
    .mockRejectedValueOnce({
      code: "app.native.unavailable",
      params: {},
      traceId: "resolve-test",
    });
  const { snapshot } = mockShellIpc(undefined, {
    objects: [job],
    activeObject: job,
  });
  renderShell(
    {
      manifests: [
        {
          ...manifest,
          workbenchObjects: [{ ...manifest.workbenchObjects[0], resolve }],
        },
      ],
    },
    `/devtools/jobs/${job.id}`,
  );
  await screen.findAllByRole("alert");
  expect(snapshot().objects).toEqual([job]);
  fireEvent.click(screen.getAllByRole("button", { name: "重试" })[0]);
  await screen.findByRole("heading", { name: `任务 ${job.id}` });
});
it("同账户权限收回立即卸载正文与辅助组件", async () => {
  mockShellIpc(undefined, {
    objects: [job],
    activeObject: job,
    auxiliary: { width: 320, visible: true, panel: "inspector" },
  });
  const view = renderShell({}, `/devtools/jobs/${job.id}`);
  await screen.findByText(`检查 ${job.id}`);
  view.update({ auth: { ...visibility, permissions: [] } });
  expect(screen.queryByText(`检查 ${job.id}`)).toBeNull();
  expect(screen.queryByRole("heading", { name: `任务 ${job.id}` })).toBeNull();
});
it("旧 scope 的 resolver 迟到结果不会显示在新权限下", async () => {
  let finish!: (
    value: Awaited<
      ReturnType<(typeof manifest.workbenchObjects)[0]["resolve"]>
    >,
  ) => void;
  const resolve = vi.fn(
    () =>
      new Promise<
        Awaited<ReturnType<(typeof manifest.workbenchObjects)[0]["resolve"]>>
      >((done) => {
        finish = done;
      }),
  );
  mockShellIpc(undefined, { objects: [job], activeObject: job });
  const view = renderShell(
    {
      manifests: [
        {
          ...manifest,
          workbenchObjects: [{ ...manifest.workbenchObjects[0], resolve }],
        },
      ],
    },
    `/devtools/jobs/${job.id}`,
  );
  await waitFor(() => expect(resolve).toHaveBeenCalled());
  view.update({ auth: { ...visibility, permissions: [] } });
  await act(async () =>
    finish({ ref: job, title: "旧身份标题", iconId: "jobs" }),
  );
  expect(screen.queryByText("旧身份标题")).toBeNull();
});
