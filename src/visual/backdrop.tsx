import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAppearanceSnapshot } from "@/core/appearance-bridge";
import { runScene, type SceneFactory } from "./scene";
import { VISUAL_THEMES } from "./themes/registry";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** 系统“减少动态效果”打开时不运行场景。 */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
  );
}

function SceneCanvas({ scene, dark }: { scene: SceneFactory; dark: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    return runScene(canvas.current, scene(17), dark);
  }, [scene, dark]);
  return <canvas ref={canvas} data-part="scene" className="visual-scene" />;
}

/** 主题背景层，固定在外壳之下；只由 app 挂载一次。 */
export function Backdrop() {
  const { style, dark, motion } = useAppearanceSnapshot();
  const reduced = useReducedMotion();
  const theme = VISUAL_THEMES[style];
  if (!theme.art) return null;
  const image = dark ? theme.art.image.dark : theme.art.image.light;
  return (
    <div aria-hidden="true" data-visual="backdrop" className="visual-backdrop">
      <img
        key={image}
        src={image}
        alt=""
        decoding="async"
        draggable={false}
        data-part="image"
        className="visual-backdrop-image"
      />
      {theme.scene && motion && !reduced && (
        <SceneCanvas scene={theme.scene} dark={dark} />
      )}
      <div data-part="veil" className="visual-backdrop-veil" />
    </div>
  );
}
