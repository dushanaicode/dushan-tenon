//! 设置到原生标题栏和底色的纯投影；窗口 API、系统明暗观察及错误呈现由宿主负责。

use crate::config::{Theme, ThemeStyle, Titlebar};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeTheme {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativeAppearance {
    pub titlebar: Titlebar,
    /// 外层 None 表示跳过标题栏 API；内层 None 表示交由系统选择。
    pub titlebar_theme: Option<Option<NativeTheme>>,
    pub background: [u8; 4],
}

/// 各主题的浅色、深色底色，与主题 CSS 的 `--background` 一致，窗口显示前不闪色。
pub fn backgrounds(style: ThemeStyle) -> ([u8; 4], [u8; 4]) {
    match style {
        ThemeStyle::Standard => ([246, 246, 247, 255], [15, 16, 18, 255]),
        ThemeStyle::Ink => ([244, 239, 228, 255], [20, 23, 26, 255]),
        ThemeStyle::Cyber => ([244, 248, 255, 255], [5, 7, 15, 255]),
    }
}

pub fn project(
    theme: Theme,
    style: ThemeStyle,
    titlebar: Titlebar,
    system: NativeTheme,
) -> NativeAppearance {
    let selected = match theme {
        Theme::Light => Some(NativeTheme::Light),
        Theme::Dark => Some(NativeTheme::Dark),
        Theme::System => None,
    };
    NativeAppearance {
        titlebar,
        titlebar_theme: (titlebar == Titlebar::Native).then_some(selected),
        background: match (selected.unwrap_or(system), backgrounds(style)) {
            (NativeTheme::Light, (light, _)) => light,
            (NativeTheme::Dark, (_, dark)) => dark,
        },
    }
}

pub fn system_theme_changed(
    theme: Theme,
    style: ThemeStyle,
    titlebar: Titlebar,
    system: NativeTheme,
) -> Option<NativeAppearance> {
    (theme == Theme::System).then(|| project(theme, style, titlebar, system))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::THEME_STYLES;

    #[test]
    fn hidden_titlebar_skips_native_theme_but_keeps_background() {
        for system in [NativeTheme::Light, NativeTheme::Dark] {
            for (theme, background) in [
                (Theme::Light, [246, 246, 247, 255]),
                (Theme::Dark, [15, 16, 18, 255]),
            ] {
                let style = ThemeStyle::Standard;
                assert_eq!(
                    project(theme, style, Titlebar::Hidden, system).titlebar_theme,
                    None
                );
                assert_eq!(
                    project(theme, style, Titlebar::Hidden, system).background,
                    background
                );
                assert!(
                    project(theme, style, Titlebar::Native, system)
                        .titlebar_theme
                        .is_some()
                );
            }
        }
    }

    #[test]
    fn every_style_projects_its_own_light_and_dark_background() {
        for style in THEME_STYLES {
            let (light, dark) = backgrounds(style);
            assert_eq!(
                project(Theme::Light, style, Titlebar::Native, NativeTheme::Dark).background,
                light
            );
            assert_eq!(
                project(Theme::Dark, style, Titlebar::Native, NativeTheme::Light).background,
                dark
            );
            assert_eq!(
                project(Theme::System, style, Titlebar::Hidden, NativeTheme::Dark).background,
                dark
            );
        }
    }

    #[test]
    fn system_changes_apply_only_to_saved_system_mode() {
        for theme in [Theme::Light, Theme::Dark] {
            assert!(
                system_theme_changed(theme, ThemeStyle::Ink, Titlebar::Native, NativeTheme::Dark)
                    .is_none()
            );
        }
        let appearance = system_theme_changed(
            Theme::System,
            ThemeStyle::Cyber,
            Titlebar::Native,
            NativeTheme::Dark,
        )
        .unwrap();
        assert_eq!(appearance.titlebar_theme, Some(None));
        assert_eq!(appearance.background, [5, 7, 15, 255]);
    }
}
