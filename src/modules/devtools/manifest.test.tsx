import { act, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import {
  activeAuth,
  appModules,
  defaultSettings,
} from "@/core/core.test-support";
import { useCanOpen } from "@/core/enabled-modules";
import {
  firstId,
  objectProps,
  renderDevtools,
  renderDevtoolsPage,
  setupJobs,
} from "./devtools.test-support";
import { JobInspector } from "./job-inspector";
import { devtoolsManifest } from "./manifest";
import { WorkbenchJobObject } from "./workbench-object";

test("清单只贡献 devPages 和 Console 可用的任务对象与检查器", () => {
  expect(devtoolsManifest.devPages.map(({ path }) => path).sort()).toEqual([
    "/devtools/jobs",
    "/devtools/jobs/:id",
    "/devtools/modules",
    "/devtools/schedules",
    "/devtools/settings",
  ]);
  for (const entries of [
    devtoolsManifest.nav,
    devtoolsManifest.routes,
    devtoolsManifest.settings,
    devtoolsManifest.headerWidgets,
    devtoolsManifest.fileTargets,
  ])
    expect(entries).toEqual([]);
  expect(
    devtoolsManifest.workbenchObjects.map(({ kind, route }) => ({
      kind,
      route,
    })),
  ).toEqual([{ kind: "job", route: "/devtools/jobs/:id" }]);
  expect(devtoolsManifest.workbenchPanels[0]).toMatchObject({
    id: "job-inspector",
    objectKind: "job",
    developerOnly: true,
    permission: "devtools.job.read",
  });
});

test.each([
  "/devtools/jobs",
  `/devtools/jobs/${firstId}`,
  "/devtools/schedules",
])("%s 无读取权限时不加载业务内容", async (path) => {
  const { calls } = setupJobs((command) =>
    command === "account_auth_status"
      ? { ...activeAuth, permissions: [] }
      : undefined,
  );
  renderDevtoolsPage(path);
  await screen.findByText("没有权限");
  expect(calls.mock.calls.some(([name]) => name.startsWith("devtools_"))).toBe(
    false,
  );
});

test.each(["/devtools/modules", "/devtools/settings"])(
  "%s 无额外全局权限仍可读取",
  async (path) => {
    setupJobs((command) =>
      command === "account_auth_status"
        ? { ...activeAuth, permissions: [] }
        : undefined,
    );
    renderDevtoolsPage(path);
    await screen.findByRole("table", {
      name: path.endsWith("modules") ? "模块列表" : "设置项检查",
    });
    expect(screen.queryByRole("heading", { name: "没有权限" })).toBeNull();
  },
);

test("计划只有读取权限时仍可查看", async () => {
  setupJobs((command) => {
    if (command === "account_auth_status")
      return { ...activeAuth, permissions: ["devtools.job.read"] };
    if (command === "devtools_schedule_list") return [];
  });
  renderDevtoolsPage("/devtools/schedules");
  expect(await screen.findByRole("table", { name: "定时计划" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "立即执行" })).toBeNull();
});

test.each(["developerMode", "module", "identity"] as const)(
  "关闭 %s 后路由不请求任务",
  async (reason) => {
    const { calls } = setupJobs((command) => {
      if (reason === "developerMode" && command === "app_settings_get")
        return defaultSettings;
      if (reason === "module" && command === "app_modules_list")
        return {
          modules: appModules.modules.map((module) => ({
            ...module,
            enabled: module.id !== "devtools",
          })),
        };
      if (reason === "identity" && command === "account_auth_status")
        return { ...activeAuth, state: "locked", permissions: [] };
    });
    renderDevtoolsPage(`/devtools/jobs/${firstId}`);
    await screen.findByText(reason === "identity" ? "没有权限" : "页面不存在");
    expect(
      calls.mock.calls.some(([name]) => name.startsWith("devtools_")),
    ).toBe(false);
  },
);

test.each(["permission", "developerMode", "module"] as const)(
  "%s 收回时工作台释放正文和检查器的观察，不取消任务",
  async (reason) => {
    const { calls, streams } = setupJobs();
    function GatedJob() {
      const canOpen = useCanOpen(`/devtools/jobs/${firstId}`);
      return canOpen ? (
        <>
          <WorkbenchJobObject {...objectProps()} />
          <JobInspector {...objectProps()} />
        </>
      ) : null;
    }
    const { client } = renderDevtools(<GatedJob />);
    await screen.findByRole("heading", { name: "任务详情" });
    await waitFor(() => expect(streams).toHaveLength(2));
    await act(async () => {
      if (reason === "permission")
        client.setQueryData(authKey, { ...activeAuth, permissions: [] });
      else if (reason === "developerMode")
        client.setQueryData(["app", "settings"], defaultSettings);
      else
        client.setQueryData(["app", "modules"], {
          modules: appModules.modules.map((module) => ({
            ...module,
            enabled: module.id !== "devtools",
          })),
        });
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "任务详情" })).toBeNull(),
    );
    expect(document.body.textContent).not.toContain(firstId);
    for (const { streamId } of streams)
      await waitFor(() =>
        expect(calls).toHaveBeenCalledWith("app_stream_cancel", {
          input: { streamId },
        }),
      );
    expect(
      calls.mock.calls.some(([name]) =>
        ["devtools_job_cancel", "devtools_job_retry"].includes(name),
      ),
    ).toBe(false);
  },
);
