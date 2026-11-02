//! 最终生效的配置来源；模块开关按完整叶子路径记录。

use std::collections::BTreeMap;

use serde::Serialize;
use tenon_framework::error::AppError;
use ts_rs::TS;

use super::SETTINGS_OVERRIDDEN;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ConfigSource {
    Default,
    File,
    Environment,
    CommandLine,
}

#[derive(Clone, Debug, Default)]
pub(super) struct ConfigSources {
    pub file_exists: bool,
    pub effective: BTreeMap<String, ConfigSource>,
}

impl ConfigSources {
    pub fn get(&self, key: &str) -> ConfigSource {
        self.effective
            .get(key)
            .copied()
            .unwrap_or(ConfigSource::Default)
    }

    pub fn keys(&self, source: ConfigSource) -> Vec<&str> {
        self.effective
            .iter()
            .filter_map(|(key, value)| (*value == source).then_some(key.as_str()))
            .collect()
    }

    pub fn check_writable(&self, key: &str) -> Result<(), AppError> {
        if matches!(
            self.get(key),
            ConfigSource::Environment | ConfigSource::CommandLine
        ) {
            return Err(AppError::new(SETTINGS_OVERRIDDEN).with_param("key", key));
        }
        Ok(())
    }
}
