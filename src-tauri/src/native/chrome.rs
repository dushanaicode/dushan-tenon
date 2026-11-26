//! 保存成功后的原生外观效果；失败保留配置，且不影响隐藏窗口的显示流程。

use tauri::{Manager, Theme, window::Color};
use tenon_desktop::{
    config::{AppSettings, Theme as UiTheme, ThemeStyle, Titlebar},
    native::{
        UNAVAILABLE,
        chrome::{NativeTheme, project},
    },
};
use tenon_framework::error::AppError;

pub(crate) trait WindowChrome: Send + Sync {
    fn apply(&self, theme: UiTheme, style: ThemeStyle, titlebar: Titlebar) -> Result<(), AppError>;
    fn set_titlebar(&self, titlebar: Titlebar) -> Result<(), AppError>;
}

pub(super) struct SystemWindowChrome(pub tauri::AppHandle);

impl WindowChrome for SystemWindowChrome {
    fn set_titlebar(&self, titlebar: Titlebar) -> Result<(), AppError> {
        let window = self
            .0
            .get_webview_window("main")
            .ok_or_else(|| AppError::new(UNAVAILABLE))?;
        // Tao 的 preferred_theme 会屏蔽系统明暗事件。仍有原生装饰时先解除
        // 上次显式模式的覆盖，随后隐藏；隐藏期间只投影底色，不再调用标题栏主题 API。
        if titlebar == Titlebar::Hidden
            && window
                .is_decorated()
                .map_err(|_| AppError::new(UNAVAILABLE))?
        {
            window
                .set_theme(None)
                .map_err(|_| AppError::new(UNAVAILABLE))?;
        }
        #[cfg(target_os = "macos")]
        {
            window
                .set_decorations(true)
                .map_err(|_| AppError::new(UNAVAILABLE))?;
            window
                .set_title_bar_style(mac_titlebar_style(titlebar))
                .map_err(|_| AppError::new(UNAVAILABLE))?;
            window
                .set_title(if titlebar == Titlebar::Hidden {
                    ""
                } else {
                    &self.0.package_info().name
                })
                .map_err(|_| AppError::new(UNAVAILABLE))
        }
        #[cfg(not(target_os = "macos"))]
        window
            .set_decorations(titlebar == Titlebar::Native)
            .map_err(|_| AppError::new(UNAVAILABLE))
    }

    fn apply(&self, theme: UiTheme, style: ThemeStyle, titlebar: Titlebar) -> Result<(), AppError> {
        let window = self
            .0
            .get_webview_window("main")
            .ok_or_else(|| AppError::new(UNAVAILABLE))?;
        let titlebar_result =
            match project(theme, style, titlebar, NativeTheme::Light).titlebar_theme {
                Some(value) => window
                    .set_theme(value.map(|theme| match theme {
                        NativeTheme::Light => Theme::Light,
                        NativeTheme::Dark => Theme::Dark,
                    }))
                    .map_err(|_| AppError::new(UNAVAILABLE)),
                None => Ok(()),
            };
        // 恢复 System 时先解除原生主题覆盖，再读取实际系统明暗。
        let system = if theme == UiTheme::System
            && window.theme().map_err(|_| AppError::new(UNAVAILABLE))? == Theme::Dark
        {
            NativeTheme::Dark
        } else {
            NativeTheme::Light
        };
        let appearance = project(theme, style, titlebar, system);
        let [r, g, b, a] = appearance.background;
        let background_result = window
            .set_background_color(Some(Color(r, g, b, a)))
            .map_err(|_| AppError::new(UNAVAILABLE));
        titlebar_result.and(background_result)
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn mac_titlebar_style(titlebar: Titlebar) -> tauri::TitleBarStyle {
    match titlebar {
        Titlebar::Native => tauri::TitleBarStyle::Transparent,
        Titlebar::Hidden => tauri::TitleBarStyle::Overlay,
    }
}

pub(crate) fn apply_saved(chrome: &dyn WindowChrome, settings: &AppSettings) {
    if let Err(error) = chrome.apply(
        settings.theme.value,
        settings.theme_style.value,
        settings.titlebar.value,
    ) {
        tracing::warn!(reason_code = %error.code(), "原生窗口外观同步失败");
    }
}

/// 建窗成功后同步应用外观，返回后调用方才可启动 reveal。
pub(crate) fn create_hidden_window<W>(
    chrome: &dyn WindowChrome,
    settings: &AppSettings,
    create: impl FnOnce() -> Result<W, AppError>,
) -> Result<W, AppError> {
    let window = create()?;
    apply_saved(chrome, settings);
    Ok(window)
}

pub(crate) fn settings_changed(
    chrome: &dyn WindowChrome,
    previous: &AppSettings,
    saved: &AppSettings,
) {
    if previous.titlebar.value != saved.titlebar.value
        && let Err(error) = chrome.set_titlebar(saved.titlebar.value)
    {
        tracing::warn!(reason_code = %error.code(), "原生窗口标题栏同步失败");
    }
    if previous.theme.value != saved.theme.value
        || previous.theme_style.value != saved.theme_style.value
        || previous.titlebar.value != saved.titlebar.value
    {
        apply_saved(chrome, saved);
    }
}

pub(crate) fn system_theme_changed(chrome: &dyn WindowChrome, saved: &AppSettings) {
    if saved.theme.value == UiTheme::System {
        apply_saved(chrome, saved);
    }
}
