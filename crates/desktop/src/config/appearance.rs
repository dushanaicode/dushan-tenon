//! 外观与界面偏好：颜色模式、视觉主题、强调色、密度、动效、语言与开发者模式。

use serde::{Deserialize, Serialize};
use tenon_framework::i18n::Language;
use ts_rs::TS;

/// 颜色模式；键名沿用 `ui.theme`。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

/// 视觉主题。新增主题时同步前端主题注册表与原生底色表。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum ThemeStyle {
    #[default]
    Standard,
    Ink,
    Cyber,
}

pub const THEME_STYLES: [ThemeStyle; 3] =
    [ThemeStyle::Standard, ThemeStyle::Ink, ThemeStyle::Cyber];

/// 强调色，只作用于标准主题；其他主题使用自带配色。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum Accent {
    #[default]
    Neutral,
    Azure,
    Violet,
    Emerald,
    Amber,
    Rose,
}

pub const ACCENTS: [Accent; 6] = [
    Accent::Neutral,
    Accent::Azure,
    Accent::Violet,
    Accent::Emerald,
    Accent::Amber,
    Accent::Rose,
];

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
}

pub const DENSITIES: [Density; 2] = [Density::Comfortable, Density::Compact];

/// 动效：跟随系统“减少动态效果”，或不论系统设置始终开启、始终关闭。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    #[default]
    System,
    On,
    Off,
}

pub const MOTIONS: [Motion; 3] = [Motion::System, Motion::On, Motion::Off];

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct UiConfig {
    pub theme: Theme,
    pub theme_style: ThemeStyle,
    pub accent: Accent,
    pub density: Density,
    pub motion: Motion,
    pub language: Language,
    pub developer_mode: bool,
}
