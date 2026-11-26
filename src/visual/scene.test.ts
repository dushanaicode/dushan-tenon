import { expect, it, vi } from "vitest";
import {
  runScene,
  SCENE_FRAME_MS,
  SCENE_MAX_PIXEL_RATIO,
  type Scene,
  type SceneHost,
  seededRandom,
} from "./scene";
import { cyberScene } from "./themes/cyber/scene";
import { inkScene } from "./themes/ink/scene";

function fakeHost(ratio = 2) {
  let hidden = false;
  let next = 1;
  const frames = new Map<number, (time: number) => void>();
  const visibility = new Set<() => void>();
  const host: SceneHost = {
    now: () => 0,
    requestFrame(callback) {
      frames.set(next, callback);
      return next++;
    },
    cancelFrame: (handle) => frames.delete(handle),
    pixelRatio: () => ratio,
    hidden: () => hidden,
    onVisibilityChange(listener) {
      visibility.add(listener);
      return () => visibility.delete(listener);
    },
  };
  return {
    host,
    frames,
    visibility,
    tick(time: number) {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(time);
    },
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of visibility) listener();
    },
  };
}

/** 记录调用的 2D 上下文替身；渐变返回同样可记录的对象。 */
function fakeContext() {
  const calls: string[] = [];
  const gradient = { addColorStop: vi.fn() };
  const context = new Proxy(
    {},
    {
      get(_, name: string) {
        if (name === "createRadialGradient" || name === "createLinearGradient")
          return () => gradient;
        return (...args: unknown[]) => {
          calls.push(`${name}(${args.length})`);
        };
      },
      set(_, name: string) {
        calls.push(`set ${name}`);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { context, calls };
}

function canvasWith(context: CanvasRenderingContext2D | null) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 400 });
  Object.defineProperty(canvas, "clientHeight", { value: 300 });
  vi.spyOn(canvas, "getContext").mockReturnValue(context as never);
  return canvas;
}

it("画布按元素尺寸和封顶的像素比设大小，30 帧节流，时间不含暂停", () => {
  const fake = fakeHost(3);
  const { context } = fakeContext();
  const canvas = canvasWith(context);
  const draw = vi.fn();
  const stop = runScene(canvas, { draw }, true, fake.host);
  fake.tick(1000);
  fake.tick(1000 + SCENE_FRAME_MS / 2);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(canvas.width).toBe(400 * SCENE_MAX_PIXEL_RATIO);
  expect(canvas.height).toBe(300 * SCENE_MAX_PIXEL_RATIO);
  fake.tick(1000 + SCENE_FRAME_MS * 2);
  expect(draw).toHaveBeenCalledTimes(2);
  expect(draw.mock.calls[1][0]).toMatchObject({
    width: 600,
    height: 450,
    dark: true,
  });
  expect(draw.mock.calls[1][0].time).toBeCloseTo((SCENE_FRAME_MS * 2) / 1000);
  fake.setHidden(true);
  expect(fake.frames.size).toBe(0);
  fake.setHidden(false);
  fake.tick(90_000);
  fake.tick(90_000 + SCENE_FRAME_MS * 2);
  expect(draw.mock.calls.at(-1)?.[0].time).toBeCloseTo(
    (SCENE_FRAME_MS * 4) / 1000,
  );
  stop();
  expect(fake.frames.size).toBe(0);
  expect(fake.visibility.size).toBe(0);
});

it("窗口隐藏时不开始，没有 2D 上下文时只留静态背景", () => {
  const fake = fakeHost();
  fake.setHidden(true);
  const { context } = fakeContext();
  const stop = runScene(
    canvasWith(context),
    { draw: vi.fn() },
    false,
    fake.host,
  );
  expect(fake.frames.size).toBe(0);
  stop();
  const none = fakeHost();
  const scene: Scene = { draw: vi.fn() };
  runScene(canvasWith(null), scene, false, none.host)();
  expect(none.frames.size).toBe(0);
  expect(none.visibility.size).toBe(0);
});

it.each([
  ["ink", inkScene],
  ["cyber", cyberScene],
] as const)("%s 场景在两种明暗下按时间作画，同一种子结果一致", (_, factory) => {
  for (const dark of [false, true]) {
    const first = fakeContext();
    const second = fakeContext();
    const a = factory(17);
    const b = factory(17);
    for (const time of [0, 1.5, 7.2, 63]) {
      a.draw({ context: first.context, width: 800, height: 450, time, dark });
      b.draw({ context: second.context, width: 800, height: 450, time, dark });
    }
    expect(first.calls.length).toBeGreaterThan(0);
    expect(first.calls).toEqual(second.calls);
  }
});

it("伪随机数确定且落在 [0, 1)", () => {
  const a = seededRandom(5);
  const b = seededRandom(5);
  for (let index = 0; index < 100; index += 1) {
    const value = a();
    expect(value).toBe(b());
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  }
});
