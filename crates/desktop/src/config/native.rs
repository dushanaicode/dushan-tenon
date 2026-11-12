//! 窗口、托盘、自启、快捷键与更新器合同；托盘和关闭动作整组检查。

use std::path::Path;

use serde::{Deserialize, Serialize};
use tenon_framework::error::AppError;
use ts_rs::TS;

use super::{
    ConfigError, LoadedConfig, Setting,
    persist::{change, invalid},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct WindowConfig {
    pub restore_state: bool,
    pub titlebar: Titlebar,
    pub close_action: CloseAction,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum Titlebar {
    #[default]
    Native,
    Hidden,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum CloseAction {
    #[default]
    Ask,
    Tray,
    Exit,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct TrayConfig {
    pub enabled: bool,
}

impl WindowConfig {
    pub(super) fn validate(&self, tray: &TrayConfig) -> Result<(), ConfigError> {
        if self.close_action == CloseAction::Tray && !tray.enabled {
            return Err(ConfigError::Field {
                path: "window.close_action".into(),
                reason: "隐藏到托盘必须同时启用托盘".into(),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct AutostartConfig {
    pub enabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct ShortcutsConfig {
    pub show_main: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct UpdaterConfig {
    pub check_on_start: bool,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            restore_state: true,
            titlebar: Titlebar::Native,
            close_action: CloseAction::default(),
        }
    }
}

impl Default for TrayConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

/// 配置事实；运行时窗口状态由宿主添加。
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeConfigSettings {
    pub restore_state: Setting<bool>,
    pub titlebar: Setting<Titlebar>,
    pub tray_enabled: Setting<bool>,
    pub close_action: Setting<CloseAction>,
    pub autostart: Setting<bool>,
    pub show_main: Setting<String>,
    pub check_on_start: Setting<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NativeSettingsChange {
    Window(WindowSettingsChange),
    Tray(TraySettingsChange),
    Autostart(AutostartSettingsChange),
    Shortcut(ShortcutSettingsChange),
    Updater(UpdaterSettingsChange),
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterSettingsChange {
    pub check_on_start: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraySettingsChange {
    pub enabled: bool,
    pub close_action: CloseAction,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutostartSettingsChange {
    pub enabled: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutSettingsChange {
    pub binding: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSettingsChange {
    pub restore_state: bool,
}

impl LoadedConfig {
    pub fn native_settings(&self) -> NativeConfigSettings {
        NativeConfigSettings {
            check_on_start: self
                .setting("updater.check_on_start", self.values.updater.check_on_start),
            restore_state: self.setting("window.restore_state", self.values.window.restore_state),
            titlebar: self.setting("window.titlebar", self.values.window.titlebar),
            tray_enabled: self.setting("tray.enabled", self.values.tray.enabled),
            close_action: self.setting("window.close_action", self.values.window.close_action),
            autostart: self.setting("autostart.enabled", self.values.autostart.enabled),
            show_main: self.setting(
                "shortcuts.show_main",
                self.values.shortcuts.show_main.clone(),
            ),
        }
    }

    pub fn update_native_settings(
        &mut self,
        root: &Path,
        input: &NativeSettingsChange,
    ) -> Result<NativeConfigSettings, AppError> {
        let mut values = self.values.clone();
        let mut changes = Vec::new();
        match input {
            NativeSettingsChange::Updater(input) => change(
                &self.sources,
                &mut changes,
                "updater.check_on_start",
                &mut values.updater.check_on_start,
                input.check_on_start,
            )?,
            NativeSettingsChange::Window(input) => change(
                &self.sources,
                &mut changes,
                "window.restore_state",
                &mut values.window.restore_state,
                input.restore_state,
            )?,
            NativeSettingsChange::Tray(input) => {
                change(
                    &self.sources,
                    &mut changes,
                    "tray.enabled",
                    &mut values.tray.enabled,
                    input.enabled,
                )?;
                change(
                    &self.sources,
                    &mut changes,
                    "window.close_action",
                    &mut values.window.close_action,
                    input.close_action,
                )?;
            }
            NativeSettingsChange::Autostart(input) => change(
                &self.sources,
                &mut changes,
                "autostart.enabled",
                &mut values.autostart.enabled,
                input.enabled,
            )?,
            NativeSettingsChange::Shortcut(input) => change(
                &self.sources,
                &mut changes,
                "shortcuts.show_main",
                &mut values.shortcuts.show_main,
                input.binding.clone(),
            )?,
        }
        values.window.validate(&values.tray).map_err(invalid)?;
        self.commit(root, values, changes)?;
        Ok(self.native_settings())
    }
}
