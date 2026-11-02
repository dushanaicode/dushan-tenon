//! 设置到原生标题栏和底色的纯投影；窗口 API、系统明暗观察及错误呈现由宿主负责。

use crate::config::{Theme, Titlebar};

pub const LIGHT_BACKGROUND: [u8; 4] = [246, 246, 247, 255];
pub const DARK_BACKGROUND: [u8; 4] = [15, 16, 18, 255];

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

pub fn project(theme: Theme, titlebar: Titlebar, system: NativeTheme) -> NativeAppearance {
    let selected = match theme {
        Theme::Light => Some(NativeTheme::Light),
        Theme::Dark => Some(NativeTheme::Dark),
        Theme::System => None,
    };
    NativeAppearance {
        titlebar,
        titlebar_theme: (titlebar == Titlebar::Native).then_some(selected),
        background: match selected.unwrap_or(system) {
            NativeTheme::Light => LIGHT_BACKGROUND,
            NativeTheme::Dark => DARK_BACKGROUND,
        },
    }
}

pub fn system_theme_changed(
    theme: Theme,
    titlebar: Titlebar,
    system: NativeTheme,
) -> Option<NativeAppearance> {
    (theme == Theme::System).then(|| project(theme, titlebar, system))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_titlebar_skips_native_theme_but_keeps_background() {
        for system in [NativeTheme::Light, NativeTheme::Dark] {
            for (theme, background) in [
                (Theme::Light, [246, 246, 247, 255]),
                (Theme::Dark, [15, 16, 18, 255]),
            ] {
                assert_eq!(
                    project(theme, Titlebar::Hidden, system).titlebar_theme,
                    None
                );
                assert_eq!(
                    project(theme, Titlebar::Hidden, system).background,
                    background
                );
                assert!(
                    project(theme, Titlebar::Native, system)
                        .titlebar_theme
                        .is_some()
                );
            }
        }
    }

    #[test]
    fn system_changes_apply_only_to_saved_system_mode() {
        for theme in [Theme::Light, Theme::Dark] {
            assert!(system_theme_changed(theme, Titlebar::Native, NativeTheme::Dark).is_none());
        }
        let appearance =
            system_theme_changed(Theme::System, Titlebar::Native, NativeTheme::Dark).unwrap();
        assert_eq!(appearance.titlebar_theme, Some(None));
        assert_eq!(appearance.background, DARK_BACKGROUND);
    }
}
