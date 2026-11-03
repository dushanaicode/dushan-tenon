import { expect, test, vi } from "vitest";
import { invoke } from "./invoke";
import { mockIpc } from "./ipc.test-support";

test("invoke 原样传递命令、参数和成功结果", async () => {
  const input = { name: "test" };
  const result = { saved: true };
  const calls = mockIpc(() => result);
  await expect(invoke("demo_sample_create", { input })).resolves.toBe(result);
  expect(calls).toHaveBeenCalledExactlyOnceWith("demo_sample_create", {
    input,
  });
});

test("结构化 IPC 错误保留公开字段，不记录日志", async () => {
  const error = {
    code: "app.input.invalid",
    params: { path: "field" },
    traceId: "trace-123",
  };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mockIpc(() => {
    throw error;
  });
  await expect(invoke("app_about_get")).rejects.toEqual(error);
  expect(log).not.toHaveBeenCalled();
});

test("结构化 IPC 错误不携带 source、cause 或底层消息", async () => {
  const error = {
    code: "app.input.invalid",
    params: { path: "field" },
    traceId: "trace-123",
  };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mockIpc(() => {
    throw {
      ...error,
      source: new Error("private source"),
      cause: { token: "private token" },
      message: "private message",
      stack: "private stack",
    };
  });
  await expect(invoke("app_about_get")).rejects.toEqual(error);
  expect(log).not.toHaveBeenCalled();
});

test.each([
  "invalid args for command app_about_get",
  null,
  { code: "app.input.invalid", params: { path: 123 }, traceId: "trace" },
  { code: "app.input.invalid", params: [], traceId: "trace" },
  { code: "app.input.invalid", params: {}, traceId: 123 },
  undefined,
  new Error("private message", { cause: "private source" }),
  { params: {}, traceId: "trace" },
  { code: "app.input.invalid", params: null, traceId: "trace" },
])("非结构化拒绝转换为界面错误，日志仅含元数据：%j", async (original) => {
  const traceId = "019a41a8-9000-4000-8000-000000000001";
  vi.spyOn(crypto, "randomUUID").mockReturnValue(traceId);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mockIpc(() => {
    throw original;
  });
  await expect(
    invoke("app_about_get", { token: "private argument" }),
  ).rejects.toEqual({
    code: "app.ipc.unexpected",
    params: {},
    traceId,
  });
  expect(log).toHaveBeenCalledExactlyOnceWith("IPC 调用失败", {
    command: "app_about_get",
    traceId,
  });
});
