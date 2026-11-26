//! 应用设置 DTO 与不可拆的具体更新；覆盖来源始终只读。

use std::path::Path;

use serde::{Deserialize, Serialize};
use tenon_framework::{
    error::{AppError, ErrorCode},
    i18n::Language,
    logging::LogLevel,
};
use ts_rs::TS;

use super::{
    Accent, AuthMode, ConfigSource, Density, LoadedConfig, Theme, ThemeStyle, Titlebar,
    persist::{change, invalid},
};

pub const SETTINGS_OVERRIDDEN: ErrorCode = ErrorCode::new("app.settings.overridden");

#[derive(Debug, Serialize, TS)]
pub struct Setting<T> {
    pub value: T,
    pub source: ConfigSource,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub titlebar: Setting<Titlebar>,
    pub desktop_notifications: Setting<bool>,
    pub language: Setting<Language>,
    pub log_level: Setting<LogLevel>,
    pub theme: Setting<Theme>,
    pub theme_style: Setting<ThemeStyle>,
    pub accent: Setting<Accent>,
    pub density: Setting<Density>,
    pub motion: Setting<bool>,
    pub developer_mode: Setting<bool>,
}

#[derive(Default, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettingsUpdate {
    #[ts(optional)]
    pub desktop_notifications: Option<bool>,
    #[ts(optional)]
    pub language: Option<Language>,
    #[ts(optional)]
    pub titlebar: Option<Titlebar>,
    #[ts(optional)]
    pub log_level: Option<LogLevel>,
    #[ts(optional)]
    pub theme: Option<Theme>,
    #[ts(optional)]
    pub theme_style: Option<ThemeStyle>,
    #[ts(optional)]
    pub accent: Option<Accent>,
    #[ts(optional)]
    pub density: Option<Density>,
    #[ts(optional)]
    pub motion: Option<bool>,
    #[ts(optional)]
    pub developer_mode: Option<bool>,
}

impl LoadedConfig {
    pub(super) fn setting<T>(&self, key: &str, value: T) -> Setting<T> {
        Setting {
            value,
            source: self.sources.get(key),
        }
    }

    pub fn settings(&self) -> AppSettings {
        AppSettings {
            titlebar: self.setting("window.titlebar", self.values.window.titlebar),
            desktop_notifications: self.setting("notify.desktop", self.values.notify.desktop),
            language: self.setting("ui.language", self.values.ui.language),
            log_level: self.setting("logging.level", self.values.logging.level),
            theme: self.setting("ui.theme", self.values.ui.theme),
            theme_style: self.setting("ui.theme_style", self.values.ui.theme_style),
            accent: self.setting("ui.accent", self.values.ui.accent),
            density: self.setting("ui.density", self.values.ui.density),
            motion: self.setting("ui.motion", self.values.ui.motion),
            developer_mode: self.setting("ui.developer_mode", self.values.ui.developer_mode),
        }
    }

    pub fn update_settings(
        &mut self,
        root: &Path,
        input: &AppSettingsUpdate,
    ) -> Result<AppSettings, AppError> {
        let mut values = self.values.clone();
        let mut changes = Vec::new();
        if let Some(value) = input.desktop_notifications {
            change(
                &self.sources,
                &mut changes,
                "notify.desktop",
                &mut values.notify.desktop,
                value,
            )?;
        }
        if let Some(value) = input.language {
            change(
                &self.sources,
                &mut changes,
                "ui.language",
                &mut values.ui.language,
                value,
            )?;
        }
        if let Some(value) = input.titlebar {
            change(
                &self.sources,
                &mut changes,
                "window.titlebar",
                &mut values.window.titlebar,
                value,
            )?;
        }
        if let Some(value) = input.log_level {
            change(
                &self.sources,
                &mut changes,
                "logging.level",
                &mut values.logging.level,
                value,
            )?;
        }
        if let Some(value) = input.theme {
            change(
                &self.sources,
                &mut changes,
                "ui.theme",
                &mut values.ui.theme,
                value,
            )?;
        }
        if let Some(value) = input.theme_style {
            change(
                &self.sources,
                &mut changes,
                "ui.theme_style",
                &mut values.ui.theme_style,
                value,
            )?;
        }
        if let Some(value) = input.accent {
            change(
                &self.sources,
                &mut changes,
                "ui.accent",
                &mut values.ui.accent,
                value,
            )?;
        }
        if let Some(value) = input.density {
            change(
                &self.sources,
                &mut changes,
                "ui.density",
                &mut values.ui.density,
                value,
            )?;
        }
        if let Some(value) = input.motion {
            change(
                &self.sources,
                &mut changes,
                "ui.motion",
                &mut values.ui.motion,
                value,
            )?;
        }
        if let Some(value) = input.developer_mode {
            change(
                &self.sources,
                &mut changes,
                "ui.developer_mode",
                &mut values.ui.developer_mode,
                value,
            )?;
        }
        self.commit(root, values, changes)?;
        Ok(self.settings())
    }

    /// 认证模式切换与补偿均通过同一事务入口，不向模块公开任意键写回。
    pub fn update_auth_mode(&mut self, root: &Path, mode: AuthMode) -> Result<(), AppError> {
        let mut values = self.values.clone();
        let mut changes = Vec::new();
        change(
            &self.sources,
            &mut changes,
            "auth.mode",
            &mut values.auth.mode,
            mode,
        )?;
        values.auth.validate().map_err(invalid)?;
        self.commit(root, values, changes)
    }
}
