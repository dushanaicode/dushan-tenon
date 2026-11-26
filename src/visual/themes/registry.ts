import type { ThemeStyle } from "@/lib/generated/ThemeStyle";
import type { SceneFactory } from "../scene";
import { cyberScene } from "./cyber/scene";
import { inkScene } from "./ink/scene";

type Art = Readonly<{ light: string; dark: string }>;

export type VisualTheme = Readonly<{
  id: ThemeStyle;
  /** 背景图与设置页缩略图，按明暗各一张；标准主题没有背景。 */
  art: Readonly<{ image: Art; thumb: Art }> | null;
  scene: SceneFactory | null;
}>;

const art = (id: ThemeStyle) => ({
  image: { light: `/themes/${id}/light.webp`, dark: `/themes/${id}/dark.webp` },
  thumb: {
    light: `/themes/${id}/light.thumb.webp`,
    dark: `/themes/${id}/dark.thumb.webp`,
  },
});

/**
 * 主题注册表，只由 app 与本层的设置组件读取。新增主题：在 desktop 的
 * `ThemeStyle` 与原生底色表登记，再在这里加一项，并提供 `themes/<id>/theme.css`、
 * `public/themes/<id>/` 的图片和两种语言的名称与说明。
 */
export const VISUAL_THEMES: Readonly<Record<ThemeStyle, VisualTheme>> = {
  standard: { id: "standard", art: null, scene: null },
  ink: { id: "ink", art: art("ink"), scene: inkScene },
  cyber: { id: "cyber", art: art("cyber"), scene: cyberScene },
};
