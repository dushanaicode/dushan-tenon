import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { authKey } from "@/core/auth";
import {
  activeAuth,
  currentUser,
  defaultSettings,
} from "@/core/core.test-support";
import type { DemoSampleDraft } from "@/lib/generated/DemoSampleDraft";
import type { FilePicked } from "@/lib/generated/FilePicked";
import type { JobSubmitted } from "@/lib/generated/JobSubmitted";
import { newId } from "@/lib/id";
import {
  mockDemoIpc,
  renderDemo,
  sample,
  setupDemo,
} from "./demo.test-support";
import { submittedJobsQuery } from "./queries";

test.each([
  "/demo/samples",
  `/demo/samples/${sample.id}`,
  "/demo/measure",
  `/demo/jobs/${sample.id}`,
])(
  "%s starts no business commands while developer mode is off",
  async (path) => {
    const calls = mockDemoIpc(undefined, {
      developerMode: { value: false, source: "file" },
    });
    const f = renderDemo(path);
    await waitFor(() =>
      expect(f.client.getQueryData(["app", "settings"])).toBeDefined(),
    );
    await screen.findByText("页面不存在");
    expect(
      calls.mock.calls.some(
        ([name]) =>
          name.startsWith("demo_") || name.startsWith("app_job_mine_"),
      ),
    ).toBe(false);
  },
);

test.each([["demo.sample.read"], ["demo.sample.run"], []])(
  "measure requires both read and run permissions: %j",
  async (...permissions) => {
    const calls = mockDemoIpc((command) =>
      command === "account_auth_status"
        ? { ...activeAuth, permissions }
        : undefined,
    );
    renderDemo("/demo/measure");
    await screen.findByText("没有权限");
    expect(calls.mock.calls.some(([name]) => name.startsWith("demo_"))).toBe(
      false,
    );
  },
);

test("a late file picker result cannot attach to another actor", async () => {
  let finish!: (file: FilePicked) => void;
  const picked = new Promise<FilePicked>((resolve) => {
    finish = resolve;
  });
  const f = setupDemo(`/demo/samples/${sample.id}`, (command) =>
    command === "app_file_pick" ? picked : undefined,
  );
  fireEvent.click(await screen.findByRole("button", { name: "添加附件" }));
  await act(async () => {
    f.client.setQueryData(authKey, {
      ...activeAuth,
      user: { ...currentUser, id: newId() },
    });
  });
  await act(async () =>
    finish({ token: "old-actor-token", fileName: "old.txt", format: null }),
  );
  expect(
    f.calls.mock.calls.some(([name]) => name === "demo_attachment_add"),
  ).toBe(false);
});

test("a late export picker result does not submit after developer mode is revoked", async () => {
  let finish!: (file: FilePicked) => void;
  const picked = new Promise<FilePicked>((resolve) => {
    finish = resolve;
  });
  const f = setupDemo("/demo/samples", (command) =>
    command === "app_file_pick" ? picked : undefined,
  );
  fireEvent.click(await screen.findByRole("button", { name: "导出" }));
  await act(async () => {
    f.client.setQueryData(["app", "settings"], defaultSettings);
  });
  await act(async () =>
    finish({ token: "old-mode-token", fileName: "old.xlsx", format: "xlsx" }),
  );
  expect(
    f.calls.mock.calls.some(([name]) => name === "demo_sample_export"),
  ).toBe(false);
});

test("a late measurement result neither navigates nor enters another actor's session list", async () => {
  let finish!: (job: JobSubmitted) => void;
  const submitted = new Promise<JobSubmitted>((resolve) => {
    finish = resolve;
  });
  const f = setupDemo("/demo/measure", (command) =>
    command === "demo_measure_start" ? submitted : undefined,
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: /CARD-1$/ }));
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  fireEvent.click(screen.getByRole("button", { name: "提交测量任务" }));
  const nextActor = newId();
  await act(async () => {
    f.client.setQueryData(authKey, {
      ...activeAuth,
      user: { ...currentUser, id: nextActor },
    });
  });
  await act(async () => finish({ jobId: newId() }));
  expect(f.router.state.location.pathname).toBe("/demo/measure");
  await waitFor(() =>
    expect(
      f.client.getQueryData(submittedJobsQuery(nextActor).queryKey),
    ).toEqual([]),
  );
  expect(
    f.client.getQueryData(submittedJobsQuery(currentUser.id).queryKey),
  ).toEqual([]);
});

test("a late draft open cannot replace the new actor's editor", async () => {
  let finish!: (draft: DemoSampleDraft) => void;
  const pending = new Promise<DemoSampleDraft>((resolve) => {
    finish = resolve;
  });
  let opens = 0;
  const f = setupDemo("/demo/samples", (command) =>
    command === "demo_draft_open" && ++opens === 1 ? pending : undefined,
  );
  fireEvent.click(await screen.findByRole("button", { name: "创建练习卡" }));
  await waitFor(() => expect(opens).toBe(1));
  await act(async () => {
    f.client.setQueryData(authKey, {
      ...activeAuth,
      user: { ...currentUser, id: newId() },
    });
  });
  await waitFor(() =>
    expect(
      f.calls.mock.calls.filter(([name]) => name === "demo_sample_list"),
    ).toHaveLength(2),
  );
  fireEvent.click(await screen.findByRole("button", { name: "创建练习卡" }));
  const form = within(
    await screen.findByRole("dialog", { name: "创建练习卡" }),
  );
  await form.findByRole("textbox", { name: "编号" });
  await act(async () =>
    finish({
      lease: { id: newId(), sessionId: newId(), revision: 7 },
      sampleId: null,
      baseVersion: null,
      baseline: { code: "", title: "", note: "" },
      fields: { code: "OLD", title: "OLD", note: "OLD" },
      recovered: false,
      conflict: false,
      updatedAt: sample.updatedAt,
    }),
  );
  expect(form.getByRole("textbox", { name: "编号" })).toHaveProperty(
    "value",
    "",
  );
});

test("permission loss during autosave prevents a late commit", async () => {
  let finish!: (receipt: { revision: number; updatedAt: string }) => void;
  const write = new Promise<{ revision: number; updatedAt: string }>(
    (resolve) => {
      finish = resolve;
    },
  );
  const f = setupDemo("/demo/samples", (command) =>
    command === "demo_draft_write" ? write : undefined,
  );
  fireEvent.click(await screen.findByRole("button", { name: "创建练习卡" }));
  const form = within(
    await screen.findByRole("dialog", { name: "创建练习卡" }),
  );
  fireEvent.change(await form.findByRole("textbox", { name: "编号" }), {
    target: { value: "HELD" },
  });
  fireEvent.change(form.getByRole("textbox", { name: "标题" }), {
    target: { value: "Held" },
  });
  fireEvent.click(form.getByRole("button", { name: "保存练习卡" }));
  await waitFor(() =>
    expect(
      f.calls.mock.calls.some(([name]) => name === "demo_draft_write"),
    ).toBe(true),
  );
  await act(async () => {
    f.client.setQueryData(authKey, {
      ...activeAuth,
      permissions: ["demo.sample.read"],
    });
  });
  await act(async () => finish({ revision: 1, updatedAt: sample.updatedAt }));
  expect(
    f.calls.mock.calls.some(([name]) => name === "demo_draft_commit"),
  ).toBe(false);
  expect(screen.queryByRole("dialog", { name: "创建练习卡" })).toBeNull();
});
