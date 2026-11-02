//! 按配置行为组织的回归测试，共用临时状态目录和三个编译期种子。

use std::{fs, path::Path};

use tempfile::TempDir;
use tenon_framework::{
    cache::{CacheConnection, CacheProvider, DEFAULT_LOCAL_CAPACITY},
    db::{DatabaseConnection, DatabaseKind},
    i18n::Language,
    logging::LogLevel,
    network::{ProxyMode, TlsMode},
};
use toml::{Table, Value};

use super::*;

mod backup;
mod cache;
mod database;
mod loading;
mod modules;
mod native;
mod proxy;
mod settings;

const PRESETS: [(&str, &str); 3] = [
    (
        "minimal",
        include_str!("../../../../../presets/minimal.toml"),
    ),
    ("tool", include_str!("../../../../../presets/tool.toml")),
    ("full", include_str!("../../../../../presets/full.toml")),
];

fn state_root() -> TempDir {
    tempfile::Builder::new()
        .prefix("tenon-config-")
        .tempdir()
        .unwrap()
}

fn read(
    root: &Path,
    environment: &[(&str, &str)],
    overrides: &[&str],
) -> Result<LoadedConfig, ConfigError> {
    load(
        root,
        environment
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string())),
        &overrides
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>(),
    )
}
