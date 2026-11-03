import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { defaultSettings } from "@/core/core.test-support";
import { i18n } from "@/core/i18n";
import { ErrorView } from "@/kit";

const startup = vi.hoisted(() => ({
  start: vi.fn(),
  initial: vi.fn(),
  render: vi.fn(),
}));
const roots: import("react-dom/client").Root[] = [];
vi.mock("./bootstrap", () => ({ startApp: startup.start }));
vi.mock("@/app/styles.css", () => ({}));
vi.mock("@/core/appearance-bridge", async (original) => ({
  ...(await original<typeof import("@/core/appearance-bridge")>()),
  getInitialSettings: startup.initial,
}));
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: vi.fn((...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      roots.push(root);
      return {
        ...root,
        render: startup.render.mockImplementation((node) => root.render(node)),
        unmount: () => root.unmount(),
      };
    }),
  };
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
});

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/kit", () => ({ ErrorView }));
  vi.doMock("@/core/i18n", () => ({ i18n }));
  startup.start.mockReset().mockResolvedValue(undefined);
  startup.initial.mockReset().mockReturnValue(defaultSettings);
  startup.render.mockClear();
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
});

test("入口在读取宿主初值后才启动应用，不制造默认设置", async () => {
  await vi.importActual("../main.tsx");
  expect(startup.start).toHaveBeenCalledWith(
    document.getElementById("root"),
    defaultSettings,
  );
  expect(startup.render).not.toHaveBeenCalled();
});

test("缺宿主初值时明确呈现错误且不启动路由", async () => {
  startup.initial.mockImplementation(() => {
    throw new Error("Host initial settings are required");
  });
  await act(async () => {
    await vi.importActual("../main.tsx");
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Host initial settings are required",
  );
  expect(startup.start).not.toHaveBeenCalled();
});

test("启动拒绝时明确显示失败", async () => {
  startup.start.mockRejectedValue(
    new Error("Host appearance bootstrap is required"),
  );
  await act(async () => {
    await vi.importActual("../main.tsx");
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Host appearance bootstrap is required",
  );
});

test("缺挂载节点时抛出明确错误", async () => {
  document.body.replaceChildren();
  await expect(vi.importActual("../main.tsx")).rejects.toThrow(
    "缺少应用挂载节点 #root",
  );
  expect(startup.start).not.toHaveBeenCalled();
});
