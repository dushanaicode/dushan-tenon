/** 氛围场景：主题在背景图之上画一层缓慢的 Canvas 2D 动画。 */
export type SceneFrame = Readonly<{
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** 场景开始后经过的秒数，窗口隐藏期间不计时。 */
  time: number;
  dark: boolean;
}>;

export type Scene = Readonly<{ draw: (frame: SceneFrame) => void }>;

/** 每次挂载生成新的场景实例；种子固定，便于复现。 */
export type SceneFactory = (seed: number) => Scene;

/** 30 帧足够表现缓慢的氛围动画，也让后台占用更低。 */
export const SCENE_FRAME_MS = 1000 / 30;
/** 高分屏上限，避免全窗口画布按 2 倍以上分辨率重绘。 */
export const SCENE_MAX_PIXEL_RATIO = 1.5;

export type SceneHost = Readonly<{
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
  pixelRatio: () => number;
  hidden: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
}>;

export const browserSceneHost: SceneHost = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  pixelRatio: () => window.devicePixelRatio,
  hidden: () => document.hidden,
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/**
 * 在画布上运行场景，返回停止函数。没有 2D 上下文的环境只显示静态背景。
 * 画布尺寸跟随元素大小；窗口隐藏时停止请求帧，恢复后从暂停处继续计时。
 */
export function runScene(
  canvas: HTMLCanvasElement,
  scene: Scene,
  dark: boolean,
  host: SceneHost = browserSceneHost,
): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  let handle: number | null = null;
  let elapsed = 0;
  let last: number | null = null;
  let drawn = -Infinity;
  const resize = () => {
    const ratio = Math.min(host.pixelRatio(), SCENE_MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };
  const frame = (time: number) => {
    handle = host.requestFrame(frame);
    if (last !== null) elapsed += time - last;
    last = time;
    if (elapsed - drawn < SCENE_FRAME_MS) return;
    drawn = elapsed;
    resize();
    context.clearRect(0, 0, canvas.width, canvas.height);
    scene.draw({
      context,
      width: canvas.width,
      height: canvas.height,
      time: elapsed / 1000,
      dark,
    });
  };
  const start = () => {
    if (handle !== null || host.hidden()) return;
    last = null;
    handle = host.requestFrame(frame);
  };
  const pause = () => {
    if (handle === null) return;
    host.cancelFrame(handle);
    handle = null;
  };
  const stopVisibility = host.onVisibilityChange(() =>
    host.hidden() ? pause() : start(),
  );
  start();
  return () => {
    pause();
    stopVisibility();
  };
}

/** 确定性伪随机数，场景用它摆放元素，不依赖 Math.random。 */
export function seededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
