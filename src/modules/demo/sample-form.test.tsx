import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it } from "vitest";
import { sample, setupDemo } from "./demo.test-support";

async function createForm() {
  fireEvent.click(await screen.findByRole("button", { name: "创建练习卡" }));
  const form = within(
    await screen.findByRole("dialog", { name: "创建练习卡" }),
  );
  await form.findByRole("textbox", { name: "编号" });
  return form;
}

it("flushes a pending edit before closing, offers recovery, and explicitly discards it", async () => {
  const fixture = setupDemo("/demo/samples");
  let form = await createForm();
  fireEvent.change(form.getByRole("textbox", { name: "编号" }), {
    target: { value: "RECOVER" },
  });
  fireEvent.change(form.getByRole("textbox", { name: "备注" }), {
    target: { value: "unfinished" },
  });
  fireEvent.click(form.getByRole("button", { name: "保留草稿并关闭" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "创建练习卡" })).toBeNull(),
  );
  expect(fixture.state.drafts.get("new")?.fields.note).toBe("unfinished");
  form = await createForm();
  fireEvent.click(form.getByRole("button", { name: "恢复草稿" }));
  expect(form.getByRole("textbox", { name: "编号" })).toHaveProperty(
    "value",
    "RECOVER",
  );
  expect(form.getByRole("textbox", { name: "备注" })).toHaveProperty(
    "value",
    "unfinished",
  );
  fireEvent.click(form.getByRole("button", { name: "放弃草稿" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "创建练习卡" })).toBeNull(),
  );
  expect(fixture.state.drafts.size).toBe(0);
  expect(
    fixture.calls.mock.calls.some(([name]) => name === "demo_draft_commit"),
  ).toBe(false);
});

it("shows an autosave failure and keeps the editor open when close cannot flush", async () => {
  const fixture = setupDemo("/demo/samples", (command) =>
    command === "demo_draft_write"
      ? Promise.reject({
          code: "app.data.version_conflict",
          params: {},
          traceId: "draft-failed",
        })
      : undefined,
  );
  const form = await createForm();
  fireEvent.change(form.getByRole("textbox", { name: "标题" }), {
    target: { value: "keep locally" },
  });
  fireEvent.click(form.getByRole("button", { name: "保留草稿并关闭" }));
  await form.findByText(/draft-failed/);
  expect(form.getByRole("textbox", { name: "标题" })).toHaveProperty(
    "value",
    "keep locally",
  );
  expect(
    fixture.calls.mock.calls.some(([name]) => name === "demo_draft_commit"),
  ).toBe(false);
});

it("blocks route departure, keeps editing on cancel, then saves with the acknowledged revision", async () => {
  const fixture = setupDemo("/demo/samples");
  const form = await createForm();
  fireEvent.change(form.getByRole("textbox", { name: "编号" }), {
    target: { value: "LEAVE" },
  });
  fireEvent.change(form.getByRole("textbox", { name: "标题" }), {
    target: { value: "保存后离开" },
  });
  await act(async () => fixture.router.navigate("/"));
  let confirmation = within(await screen.findByRole("alertdialog"));
  fireEvent.click(confirmation.getByRole("button", { name: "继续编辑" }));
  expect(fixture.router.state.location.pathname).toBe("/demo/samples");
  expect(form.getByRole("textbox", { name: "编号" })).toHaveProperty(
    "value",
    "LEAVE",
  );
  await act(async () => fixture.router.navigate("/"));
  confirmation = within(await screen.findByRole("alertdialog"));
  fireEvent.click(confirmation.getByRole("button", { name: "保存并离开" }));
  await waitFor(() => expect(fixture.router.state.location.pathname).toBe("/"));
  expect(fixture.calls).toHaveBeenCalledWith("demo_draft_commit", {
    input: expect.objectContaining({ revision: 1 }),
  });
  expect(fixture.state.rows.some(({ code }) => code === "LEAVE")).toBe(true);
});

it("keeps the route and draft when discard fails, then leaves after a successful discard", async () => {
  let failing = true;
  const fixture = setupDemo("/demo/samples", (command) =>
    command === "demo_draft_discard" && failing
      ? Promise.reject({
          code: "app.data.version_conflict",
          params: {},
          traceId: "discard-failed",
        })
      : undefined,
  );
  const form = await createForm();
  fireEvent.change(form.getByRole("textbox", { name: "标题" }), {
    target: { value: "保留输入" },
  });
  await act(async () => fixture.router.navigate("/"));
  const confirmation = within(await screen.findByRole("alertdialog"));
  fireEvent.click(confirmation.getByRole("button", { name: "放弃修改" }));
  await confirmation.findByText(/discard-failed/);
  expect(fixture.router.state.location.pathname).toBe("/demo/samples");
  expect(
    form.getByRole("textbox", { name: "标题", hidden: true }),
  ).toHaveProperty("value", "保留输入");
  failing = false;
  fireEvent.click(confirmation.getByRole("button", { name: "放弃修改" }));
  await waitFor(() => expect(fixture.router.state.location.pathname).toBe("/"));
});

it("a recovered draft with a changed record version can only start fresh", async () => {
  const fixture = setupDemo(`/demo/samples/${sample.id}`);
  fireEvent.click(await screen.findByRole("button", { name: "编辑练习卡" }));
  let form = within(await screen.findByRole("dialog", { name: "编辑练习卡" }));
  fireEvent.change(await form.findByRole("textbox", { name: "备注" }), {
    target: { value: "尚未提交" },
  });
  fireEvent.click(form.getByRole("button", { name: "保留草稿并关闭" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "编辑练习卡" })).toBeNull(),
  );
  fixture.state.rows = [{ ...sample, rowVersion: 4, note: "其他会话已修改" }];
  await act(async () => {
    await fixture.client.invalidateQueries({ queryKey: ["demo"] });
  });
  fireEvent.click(await screen.findByRole("button", { name: "编辑练习卡" }));
  form = within(await screen.findByRole("dialog", { name: "编辑练习卡" }));
  await form.findByText(
    "原记录已变化，草稿不能覆盖。可保留草稿，或放弃后重新编辑。",
  );
  expect(form.queryByRole("button", { name: "恢复草稿" })).toBeNull();
  expect(form.getByRole("button", { name: "保存练习卡" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(form.getByRole("button", { name: "放弃草稿并重新开始" }));
  await waitFor(() =>
    expect(form.getByRole("textbox", { name: "备注" })).toHaveProperty(
      "value",
      "其他会话已修改",
    ),
  );
  expect(fixture.state.drafts.get(sample.id)?.baseVersion).toBe(4);
});
