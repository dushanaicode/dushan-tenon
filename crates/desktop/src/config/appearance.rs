//! 最小外观：明暗模式、语言与开发者模式，无可调轴或 DOM 元数据。

use serde::{Deserialize, Serialize};
use tenon_framework::i18n::Language;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct UiConfig {
    pub theme: Theme,
    pub language: Language,
    pub developer_mode: bool,
}
