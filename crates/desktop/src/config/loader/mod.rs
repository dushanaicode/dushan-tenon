//! 原始 TOML 形状只在加载边界存在；覆盖完成后一次转换为服务配置。

use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use tenon_framework::{
    job::JobsConfig,
    logging::LoggingConfig,
    network::{ProxyConfig, ProxyMode},
};
use thiserror::Error;
use toml::{Table, Value};

use super::{
    AppConfig, AuthConfig, ConfigSource, ConfigSources, LoadedConfig, ModuleConfig, NotifyConfig,
    UiConfig, native,
};

mod cache;
mod database;
mod remote;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("无法读取配置文件 {path}: {source}")]
    Read { path: PathBuf, source: io::Error },
    #[error("配置文件 {path} TOML 语法错误: {source}")]
    Syntax {
        path: PathBuf,
        source: toml::de::Error,
    },
    #[error("配置覆盖项格式错误（{origin}）: {raw:?}；需要非空的段名和键名，以及 = 分隔的值")]
    Override { origin: &'static str, raw: String },
    #[error("配置字段 {path} 非法: {reason}")]
    Field { path: String, reason: String },
}

impl ConfigError {
    pub(super) fn field(path: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Field {
            path: path.into(),
            reason: reason.into(),
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct RawConfig {
    notify: NotifyConfig,
    window: native::WindowConfig,
    tray: native::TrayConfig,
    autostart: native::AutostartConfig,
    shortcuts: native::ShortcutsConfig,
    updater: native::UpdaterConfig,
    network: RawNetwork,
    jobs: RawJobs,
    auth: AuthConfig,
    modules: BTreeMap<String, ModuleConfig>,
    cache: cache::RawCache,
    database: database::RawDatabase,
    logging: LoggingConfig,
    ui: UiConfig,
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct RawNetwork {
    proxy_mode: ProxyMode,
    proxy_endpoint: String,
    proxy_auth: bool,
}

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields)]
struct RawJobs {
    max_concurrency: usize,
    lease_seconds: u64,
}

impl Default for RawJobs {
    fn default() -> Self {
        Self {
            max_concurrency: 4,
            lease_seconds: 30,
        }
    }
}

pub(super) fn jobs_config(
    max_concurrency: usize,
    lease_seconds: u64,
) -> Result<JobsConfig, ConfigError> {
    JobsConfig::new(max_concurrency, lease_seconds).map_err(|_| {
        ConfigError::field(
            if !(1..=64).contains(&max_concurrency) {
                "jobs.max_concurrency"
            } else {
                "jobs.lease_seconds"
            },
            "超出任务执行器允许范围",
        )
    })
}

/// 文件 → 注入的 TENON__ 环境变量 → --set；不会读取进程环境或创建缺失文件。
pub fn load(
    state_root: &Path,
    environment: impl IntoIterator<Item = (String, String)>,
    overrides: &[String],
) -> Result<LoadedConfig, ConfigError> {
    let text = read_file(state_root)?;
    load_text(state_root, text.as_deref(), environment, overrides)
}

pub(super) fn read_file(root: &Path) -> Result<Option<String>, ConfigError> {
    let path = root.join("config.toml");
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(ConfigError::Read { path, source }),
    }
}

pub(super) fn load_text(
    state_root: &Path,
    text: Option<&str>,
    environment: impl IntoIterator<Item = (String, String)>,
    overrides: &[String],
) -> Result<LoadedConfig, ConfigError> {
    let mut table = text
        .unwrap_or("")
        .parse::<Table>()
        .map_err(|source| ConfigError::Syntax {
            path: state_root.join("config.toml"),
            source,
        })?;
    let mut sources = ConfigSources {
        file_exists: text.is_some(),
        ..Default::default()
    };
    for (section, value) in &table {
        if let Value::Table(fields) = value {
            for (field, value) in fields {
                if section == "modules" {
                    if let Value::Table(fields) = value {
                        for name in fields.keys() {
                            sources
                                .effective
                                .insert(format!("{section}.{field}.{name}"), ConfigSource::File);
                        }
                    }
                } else {
                    sources
                        .effective
                        .insert(format!("{section}.{field}"), ConfigSource::File);
                }
            }
        }
    }
    for (name, value) in environment {
        let normalized = name.to_ascii_lowercase();
        if let Some(key) = normalized.strip_prefix("tenon__") {
            let key = apply_override(
                &mut table,
                key,
                "__",
                &value,
                "环境变量",
                &format!("{name}={value}"),
            )?;
            record_override(&mut sources, &table, key, ConfigSource::Environment);
        }
    }
    for raw in overrides {
        let (key, value) = raw.split_once('=').ok_or_else(|| ConfigError::Override {
            origin: "--set",
            raw: raw.clone(),
        })?;
        let key = apply_override(&mut table, key, ".", value, "--set", raw)?;
        record_override(&mut sources, &table, key, ConfigSource::CommandLine);
    }
    let raw: RawConfig = serde_path_to_error::deserialize(table)
        .map_err(|error| ConfigError::field(error.path().to_string(), error.inner().to_string()))?;
    raw.auth.validate()?;
    raw.window.validate(&raw.tray)?;
    let values = AppConfig {
        database: raw.database.into_config(state_root)?,
        cache: raw.cache.into_config(state_root)?,
        jobs: jobs_config(raw.jobs.max_concurrency, raw.jobs.lease_seconds)?,
        network: ProxyConfig::new(
            raw.network.proxy_mode,
            raw.network.proxy_endpoint,
            raw.network.proxy_auth,
        )
        .map_err(|_| {
            ConfigError::field(
                "network.proxy_endpoint",
                "需要无凭据、路径、查询或片段的 HTTP/HTTPS 代理；HTTP 仅限精确回环",
            )
        })?,
        notify: raw.notify,
        window: raw.window,
        tray: raw.tray,
        autostart: raw.autostart,
        shortcuts: raw.shortcuts,
        updater: raw.updater,
        auth: raw.auth,
        modules: raw.modules,
        logging: raw.logging,
        ui: raw.ui,
    };
    Ok(LoadedConfig { values, sources })
}

fn record_override(sources: &mut ConfigSources, table: &Table, key: String, source: ConfigSource) {
    let prefix = format!("{key}.");
    sources
        .effective
        .retain(|path, _| path != &key && !path.starts_with(&prefix));
    if let Some(name) = key.strip_prefix("modules.")
        && !name.contains('.')
    {
        // 两段覆盖可直接提供模块内联表；被替换掉的叶子回归默认来源。
        if let Some(Value::Table(fields)) = table
            .get("modules")
            .and_then(Value::as_table)
            .and_then(|modules| modules.get(name))
        {
            for field in fields.keys() {
                sources.effective.insert(format!("{key}.{field}"), source);
            }
        }
    } else {
        sources.effective.insert(key, source);
    }
}

fn apply_override(
    table: &mut Table,
    key: &str,
    separator: &str,
    value: &str,
    origin: &'static str,
    raw: &str,
) -> Result<String, ConfigError> {
    let parts: Vec<_> = key.split(separator).collect();
    if (parts.len() != 2 && !(parts.len() == 3 && parts[0] == "modules"))
        || parts.iter().any(|part| {
            part.is_empty()
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
    {
        return Err(ConfigError::Override {
            origin,
            raw: raw.to_owned(),
        });
    }
    let mut section_table = table;
    for (index, part) in parts[..parts.len() - 1].iter().enumerate() {
        section_table = section_table
            .entry(*part)
            .or_insert_with(|| Value::Table(Table::new()))
            .as_table_mut()
            .ok_or_else(|| ConfigError::field(parts[..=index].join("."), "配置段必须是 TOML 表"))?;
    }
    let value = value
        .parse::<Value>()
        .unwrap_or_else(|_| Value::String(value.to_owned()));
    section_table.insert(parts[parts.len() - 1].to_string(), value);
    Ok(parts.join("."))
}
