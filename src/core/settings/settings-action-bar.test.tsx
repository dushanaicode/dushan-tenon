import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import type { SettingSetInput } from "@/lib/generated/SettingSetInput";
import {
  mockSampleIpc,
  sampleFixture,
  sampleName,
} from "./param-form.test-support";
import { renderSettings } from "./settings.test-support";

const bar = () => screen.queryByRole("region", { name: "设置操作" });

test("批量保存等待期间离开秘密行，不提交已卸载的本地秘密", async () => {
  const entries = structuredClone([...sampleFixture.params]);
  const batch = entries.find((entry) => entry.key === "sample.batch_size");
  if (!batch) throw new Error("缺少样板批次夹具");
  let finish!: (value: ParamEntry) => void;
  const pending = new Promise<ParamEntry>((resolve) => {
    finish = resolve;
  });
  const calls = mockSampleIpc((command) => {
    if (command === "app_setting_list") return structuredClone(entries);
    if (command === "app_setting_set") return pending;
  });
  const { router, client } = renderSettings("/settings/sample");
  fireEvent.change(await screen.findByRole("textbox", { name: sampleName }), {
    target: { value: "44" },
  });
  fireEvent.change(screen.getByLabelText("测试秘密", { selector: "input" }), {
    target: { value: "local-secret-sentinel" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([name]) => name === "app_setting_set"),
    ).toHaveLength(1),
  );
  await act(async () => router.navigate("/settings/general"));
  await screen.findByRole("region", { name: "通用" });
  batch.value = "44";
  batch.rowVersion = 1;
  await act(async () => finish(structuredClone(batch)));
  await waitFor(() => expect(bar()).toBeNull());
  expect(
    calls.mock.calls.filter(([name]) => name === "app_setting_set"),
  ).toHaveLength(1);
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state),
    ),
  ).not.toContain("local-secret-sentinel");
  await act(async () => router.navigate("/settings/sample"));
  expect(
    await screen.findByLabelText("测试秘密", { selector: "input" }),
  ).toHaveProperty("value", "");
});

test("跨分节依次保存多个参数，失败项保留、其它项继续，离页确认仍拦截", async () => {
  const entries = structuredClone([...sampleFixture.params]);
  const first = entries[0];
  const second = entries.find((entry) => entry.key === "sample.batch_size");
  if (!second) throw new Error("缺少样板参数夹具");
  let finish!: (value: ParamEntry) => void;
  const pending = new Promise<ParamEntry>((resolve) => {
    finish = resolve;
  });
  const writes: string[] = [];
  const calls = mockSampleIpc((command, payload) => {
    if (command === "app_setting_list") return structuredClone(entries);
    if (command === "app_setting_set") {
      const { input } = payload as { input: SettingSetInput };
      writes.push(input.key);
      if (input.key === first.key) return pending;
      throw {
        code: "app.data.version_conflict",
        params: {},
        traceId: "param-second-failed",
      };
    }
  });
  const { router } = renderSettings("/settings/param.account.security");
  fireEvent.change(
    await screen.findByRole("textbox", { name: "空闲自动锁定（分钟）" }),
    { target: { value: "22" } },
  );
  await act(async () => router.navigate("/settings/sample"));
  fireEvent.change(await screen.findByRole("textbox", { name: sampleName }), {
    target: { value: "45" },
  });
  await act(async () => router.navigate("/settings/general"));
  await screen.findByRole("region", { name: "通用" });
  expect(screen.getByText("2 项更改未应用")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await waitFor(() => expect(writes).toEqual([first.key]));
  expect(screen.getByRole("button", { name: "应用" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "放弃" })).toHaveProperty(
    "disabled",
    true,
  );
  first.value = "22";
  first.rowVersion = 1;
  await act(async () => finish(structuredClone(first)));
  await screen.findByText("1 项保存失败");
  expect(writes).toEqual([first.key, second.key]);
  expect(screen.queryByText("正在保存…")).toBeNull();
  expect(screen.getByText("1 项更改未应用")).toBeTruthy();
  await act(async () => router.navigate("/settings/sample"));
  expect(
    await screen.findByRole("textbox", { name: sampleName }),
  ).toHaveProperty("value", "45");
  expect(screen.getByText(/param-second-failed/)).toBeTruthy();
  expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  await act(async () => router.navigate("/"));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "继续编辑",
    }),
  );
  expect(bar()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "放弃" }));
  await act(async () => router.navigate("/"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(
    calls.mock.calls.filter(([command]) => command === "app_setting_set"),
  ).toHaveLength(2);
});
