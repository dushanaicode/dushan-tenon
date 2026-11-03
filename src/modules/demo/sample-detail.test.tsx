import { fireEvent, screen, within } from "@testing-library/react";
import { assert, expect, test } from "vitest";
import type { DemoDraftLease } from "@/lib/generated/DemoDraftLease";
import type { DemoSample } from "@/lib/generated/DemoSample";
import { sample, setupDemo } from "./demo.test-support";

test("edit keeps starting version and input on conflict, then shows real count", async () => {
  let conflict = true;
  const fixture = setupDemo(
    `/demo/samples/${sample.id}`,
    (command, payload) => {
      if (command === "demo_draft_commit") {
        if (conflict)
          return Promise.reject({
            code: "app.data.version_conflict",
            params: {},
            traceId: "version-trace",
          });
        const input = (payload as { input: DemoDraftLease }).input;
        const draft = [...fixture.state.drafts.values()].find(
          (draft) => draft.lease.id === input.id,
        );
        assert(draft);
        const updated: DemoSample = {
          ...sample,
          ...draft.fields,
          rowVersion: 4,
          characterCount: null,
          stage: "draft",
        };
        fixture.state.rows = [updated];
        return updated;
      }
    },
    [{ ...sample, stage: "ready", characterCount: 3 }],
  );
  await screen.findByRole("heading", { name: "真实练习卡" });
  expect(
    fixture.container.querySelector('[data-slot="key-value-list"]'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "编辑练习卡" }));
  const form = within(
    await screen.findByRole("dialog", { name: "编辑练习卡" }),
  );
  expect(
    ((await form.findByRole("textbox", { name: "编号" })) as HTMLInputElement)
      .readOnly,
  ).toBe(true);
  fireEvent.change(form.getByRole("textbox", { name: "备注" }), {
    target: { value: "修改后的备注" },
  });
  fireEvent.click(form.getByRole("button", { name: "保存练习卡" }));
  await form.findByText(/version-trace/);
  expect(
    (form.getByRole("textbox", { name: "备注" }) as HTMLTextAreaElement).value,
  ).toBe("修改后的备注");
  expect(fixture.calls).toHaveBeenCalledWith("demo_draft_write", {
    input: {
      lease: expect.objectContaining({ revision: 0 }),
      fields: { code: sample.code, title: sample.title, note: "修改后的备注" },
    },
  });
  expect(fixture.state.drafts.get(sample.id)?.baseVersion).toBe(3);
  conflict = false;
  fireEvent.click(form.getByRole("button", { name: "保存练习卡" }));
  await screen.findByText("尚未测量");
  expect(screen.queryByRole("dialog", { name: "编辑练习卡" })).toBeNull();
});

test.each([
  ["demo.sample.not_found", "练习卡不存在或不属于当前账号。"],
  ["app.permission.denied", "权限不足"],
  ["app.data.version_conflict", "version-fault"],
] as const)(
  "detail errors preserve their own code and trace: %s",
  async (code, message) => {
    const { container } = setupDemo(`/demo/samples/${sample.id}`, (command) =>
      command === "demo_sample_get"
        ? Promise.reject({ code, params: {}, traceId: "version-fault" })
        : undefined,
    );
    await screen.findByText(/version-fault/);
    expect(container.querySelector('[data-slot="status-page"]')).toBeTruthy();
    if (code === "demo.sample.not_found")
      expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑练习卡" })).toBeNull();
  },
);

test("deletion keeps the confirmation open on a version conflict and navigates only after success", async () => {
  let conflict = true;
  const fixture = setupDemo(`/demo/samples/${sample.id}`, (command) => {
    if (command !== "demo_sample_delete") return undefined;
    if (conflict)
      return Promise.reject({
        code: "app.data.version_conflict",
        params: {},
        traceId: "delete-trace",
      });
    fixture.state.rows = [];
    return null;
  });
  fireEvent.click(await screen.findByRole("button", { name: "删除练习卡" }));
  const confirm = within(await screen.findByRole("alertdialog"));
  fireEvent.click(confirm.getByRole("button", { name: "确认移除" }));
  await confirm.findByText(/delete-trace/);
  expect(fixture.router.state.location.pathname).toBe(
    `/demo/samples/${sample.id}`,
  );
  conflict = false;
  fireEvent.click(confirm.getByRole("button", { name: "确认移除" }));
  await screen.findByText("尚无练习卡");
  expect(fixture.router.state.location.pathname).toBe("/demo/samples");
  expect(fixture.calls).toHaveBeenCalledWith("demo_sample_delete", {
    input: { id: sample.id, rowVersion: 3 },
  });
});
