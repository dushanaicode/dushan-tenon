import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { authKey } from "@/core/auth";
import {
  codes,
  fillPassword,
  mockAuth,
  renderAccount,
} from "./account.test-support";

afterEach(() => vi.unstubAllGlobals());

test("维护忙保留已验证子树与草稿，恢复后继续使用同一界面", async () => {
  let busy = false;
  mockAuth("active", "login", (command) =>
    busy && command === "account_auth_status"
      ? Promise.reject({
          code: "app.operation.busy",
          params: {},
          traceId: "busy",
        })
      : undefined,
  );
  const { client } = renderAccount(
    "/",
    <input aria-label="业务草稿" defaultValue="草稿" />,
  );
  const draft = await screen.findByLabelText("业务草稿");
  fireEvent.change(draft, { target: { value: "未保存内容" } });
  busy = true;
  await act(() => client.refetchQueries({ queryKey: authKey }));
  expect(screen.getByLabelText("业务草稿")).toBe(draft);
  expect(draft).toHaveProperty("value", "未保存内容");
  expect(screen.queryByRole("alert")).toBeNull();
  busy = false;
  await act(() => client.refetchQueries({ queryKey: authKey }));
  expect(screen.getByLabelText("业务草稿")).toBe(draft);
});

test("锁屏取消并移除业务缓存，迟到结果不能恢复缓存，公开偏好保留", async () => {
  const { status } = mockAuth("active");
  const { client } = renderAccount();
  await screen.findByRole("navigation");
  const settings = { language: "zh-CN" };
  client.setQueryData(["app", "settings"], settings);
  client.setQueryData(["private", "saved"], "业务数据");
  let complete!: (value: string) => void;
  const query = client.fetchQuery({
    queryKey: ["private", "pending"],
    queryFn: () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
  });
  const cancelled = query.catch(() => undefined);
  status.state = "locked";
  await act(() => client.refetchQueries({ queryKey: authKey }));
  await screen.findByRole("heading", { name: "已锁定" });
  await act(async () => {
    complete("迟到业务数据");
    await cancelled;
  });
  expect(client.getQueryData(["private", "saved"])).toBeUndefined();
  expect(client.getQueryData(["private", "pending"])).toBeUndefined();
  expect(client.getQueryData(["app", "settings"])).toEqual(settings);
  expect(screen.queryByRole("navigation")).toBeNull();
});

test.each([
  ["initRequired", "设置所有者密码"],
  ["confirmRequired", "确认关闭登录"],
  ["anonymous", "登录"],
  ["locked", "已锁定"],
] as const)("认证门呈现 %s 并保留公开偏好", async (state, heading) => {
  const { calls } = mockAuth(state);
  renderAccount("/settings");
  expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
  const scroll = screen.getByRole("main").closest('[data-kit="scroll-area"]');
  expect(scroll?.getAttribute("data-region")).toBe("content");
  expect(scroll?.getAttribute("data-axis")).toBe("y");
  expect(scroll?.classList.contains("h-dvh")).toBe(true);
  expect(screen.getByRole("main").parentElement?.dataset.slot).toBe(
    "scroll-plate",
  );
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.getByRole("banner").textContent).toBe("公开偏好");
  expect(
    calls.mock.calls.some(([command]) => command === "app_about_get"),
  ).toBe(false);
});

test("登录只输入密码，解锁与会话控件使用共享认证状态", async () => {
  const { calls } = mockAuth("anonymous");
  renderAccount();
  await screen.findByRole("heading", { name: "登录" });
  expect(screen.queryByLabelText("用户名")).toBeNull();
  expect(screen.getByLabelText("密码")).toHaveProperty(
    "autocomplete",
    "current-password",
  );
  expect(screen.getByRole("main").querySelectorAll("input")).toHaveLength(1);
  fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("navigation");
  expect(calls).toHaveBeenCalledWith("account_auth_login", {
    input: { password: "test-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "锁定" }));
  await screen.findByRole("heading", { name: "已锁定" });
  fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "解锁" }));
  await screen.findByRole("navigation");
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("heading", { name: "登录" });
});

test("初始化确认密码后显示一次性恢复码，保存后进入外壳", async () => {
  const { calls } = mockAuth("initRequired");
  renderAccount();
  await screen.findByRole("heading", { name: "设置所有者密码" });
  fillPassword();
  fireEvent.change(screen.getByLabelText("确认密码"), {
    target: { value: "different" },
  });
  fireEvent.click(screen.getByRole("button", { name: "设置所有者密码" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "两次输入的密码不一致",
  );
  expect(
    calls.mock.calls.some(([command]) => command === "account_auth_initialize"),
  ).toBe(false);
  fillPassword(true);
  fireEvent.click(screen.getByRole("button", { name: "设置所有者密码" }));
  await screen.findByRole("heading", { name: "保存恢复码" });
  for (const code of codes) expect(screen.getByText(code)).toBeTruthy();
  expect(screen.queryByRole("navigation")).toBeNull();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  fireEvent.click(screen.getByRole("button", { name: "复制恢复码" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(codes.join("\n")));
  fireEvent.click(screen.getByRole("button", { name: "我已保存" }));
  await screen.findByRole("navigation");
  expect(screen.queryByText(codes[0])).toBeNull();
});

test("登录缺少密码时提示且不调用命令", async () => {
  const { calls } = mockAuth("anonymous");
  renderAccount();
  await screen.findByRole("heading", { name: "登录" });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  expect(screen.getByRole("alert").textContent).toBe("请填写所有字段。");
  expect(
    calls.mock.calls.some(([command]) => command === "account_auth_login"),
  ).toBe(false);
});

test("初始化后退出会话会清除尚未确认保存的恢复码", async () => {
  const { status } = mockAuth("initRequired");
  const { client } = renderAccount();
  await screen.findByRole("heading", { name: "设置所有者密码" });
  fillPassword(true);
  fireEvent.click(screen.getByRole("button", { name: "设置所有者密码" }));
  await screen.findByRole("heading", { name: "保存恢复码" });
  status.state = "locked";
  await act(() => client.invalidateQueries({ queryKey: authKey }));
  await screen.findByRole("heading", { name: "已锁定" });
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("heading", { name: "登录" });
  fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("navigation");
  expect(screen.queryByText(codes[0])).toBeNull();
});

test.each(["query", "mutation"] as const)(
  "%s 的认证错误由共享查询客户端切到锁屏",
  async (kind) => {
    const { status } = mockAuth("active");
    const { client } = renderAccount();
    await screen.findByRole("navigation");
    const failure = {
      code: "account.session.locked",
      params: {},
      traceId: "locked-trace",
    };
    status.state = "locked";
    const operation = () => Promise.reject(failure);
    await act(async () => {
      if (kind === "query")
        await expect(
          client.fetchQuery({ queryKey: ["protected"], queryFn: operation }),
        ).rejects.toEqual(failure);
      else
        await expect(
          client
            .getMutationCache()
            .build(client, { mutationFn: operation })
            .execute(undefined),
        ).rejects.toEqual(failure);
    });
    await screen.findByRole("heading", { name: "已锁定" });
    expect(screen.queryByRole("navigation")).toBeNull();
  },
);
test("状态查询加载与存储错误保持外壳关闭，可以重试", async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise((_, rejectPromise) => {
    reject = rejectPromise;
  });
  mockAuth("anonymous", "login", (command) =>
    command === "account_auth_status" ? pending : undefined,
  );
  renderAccount();
  await screen.findByText("正在检查登录状态…");
  reject({ code: "app.cache.unavailable", params: {}, traceId: "cache-trace" });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "cache-trace",
  );
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  expect(screen.queryByRole("navigation")).toBeNull();
});

test("初次维护忙仍显示错误，保留重试入口", async () => {
  mockAuth("active", "login", (command) =>
    command === "account_auth_status"
      ? Promise.reject({
          code: "app.operation.busy",
          params: {},
          traceId: "first-auth-load",
        })
      : undefined,
  );
  renderAccount("/settings/data");
  expect((await screen.findByRole("alert")).textContent).toContain(
    "first-auth-load",
  );
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "受保护操作" })).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
});

test.each(["app.cache.unavailable", "app.operation.busy.extra"])(
  "非精确维护忙错误卸载受保护内容：%s",
  async (code) => {
    let failed = false;
    mockAuth("active", "login", (command) =>
      failed && command === "account_auth_status"
        ? Promise.reject({ code, params: {}, traceId: "auth-refresh-failed" })
        : undefined,
    );
    const { client } = renderAccount("/settings/data");
    await screen.findByRole("button", { name: "受保护操作" });
    failed = true;
    await act(() => client.refetchQueries({ queryKey: authKey }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "auth-refresh-failed",
    );
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "受保护操作" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  },
);
