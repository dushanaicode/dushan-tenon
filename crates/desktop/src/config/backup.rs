//! JSON 备份投影的明确白名单；合并只返回配置文本，由宿主决定暂存与恢复编排。

use std::{collections::BTreeMap, path::Path};

use serde::{Deserialize, Serialize};
use tenon_framework::{i18n::Language, logging::LoggingConfig};

use super::{
    Accent, AuthMode, ConfigError, Density, ModuleConfig, NotifyConfig, Theme, ThemeStyle,
    UiConfig, loader, persist,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BackupConfig {
    pub ui: BackupUi,
    pub auth: BackupAuth,
    pub modules: BTreeMap<String, ModuleConfig>,
    pub jobs: BackupJobs,
    pub logging: LoggingConfig,
    pub notify: NotifyConfig,
    pub database: BackupDatabase,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BackupUi {
    pub theme: Theme,
    pub theme_style: ThemeStyle,
    pub accent: Accent,
    pub density: Density,
    pub motion: bool,
    pub language: Language,
    pub developer_mode: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BackupAuth {
    pub mode: AuthMode,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BackupJobs {
    pub max_concurrency: usize,
    pub lease_seconds: u64,
}

/// 归档只声明 SQLite 数据；设备数据库连接和快照保留数不属于投影。
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum BackupDatabase {
    Sqlite {},
}

/// 只读取文件来源，不携带环境/命令行覆盖、注释或设备私有配置。
pub fn project_backup(root: &Path) -> Result<BackupConfig, ConfigError> {
    let file = loader::load(root, [], &[])?;
    Ok(BackupConfig {
        ui: BackupUi {
            theme: file.values.ui.theme,
            theme_style: file.values.ui.theme_style,
            accent: file.values.ui.accent,
            density: file.values.ui.density,
            motion: file.values.ui.motion,
            language: file.values.ui.language,
            developer_mode: file.values.ui.developer_mode,
        },
        auth: BackupAuth {
            mode: file.values.auth.mode,
        },
        modules: file.values.modules,
        jobs: BackupJobs {
            max_concurrency: file.values.jobs.max_concurrency(),
            lease_seconds: file.values.jobs.lease_seconds(),
        },
        logging: file.values.logging,
        notify: file.values.notify,
        database: BackupDatabase::Sqlite {},
    })
}

/// 目标文件只读一次；类型化合并后保留目标设备字段、认证策略及 developer_mode。
/// 不修改目标文件，也不读取环境变量；恢复入口负责校验有效后端并落盘。
pub fn merge_backup(target: &Path, backup: &BackupConfig) -> Result<String, ConfigError> {
    let text = loader::read_file(target)?;
    let mut values = loader::load_text(target, text.as_deref(), [], &[])?.values;
    values.auth.mode = backup.auth.mode;
    values.auth.validate()?;
    values.jobs = loader::jobs_config(backup.jobs.max_concurrency, backup.jobs.lease_seconds)?;
    values.ui = UiConfig {
        theme: backup.ui.theme,
        theme_style: backup.ui.theme_style,
        accent: backup.ui.accent,
        density: backup.ui.density,
        motion: backup.ui.motion,
        language: backup.ui.language,
        developer_mode: values.ui.developer_mode,
    };
    values.modules = backup.modules.clone();
    values.logging = backup.logging.clone();
    values.notify = backup.notify;

    let mut document = text
        .unwrap_or_default()
        .parse::<toml_edit::DocumentMut>()
        .map_err(|error| ConfigError::field("config.toml", error.to_string()))?;
    set(&mut document, "ui", "theme", &values.ui.theme)?;
    set(&mut document, "ui", "theme_style", &values.ui.theme_style)?;
    set(&mut document, "ui", "accent", &values.ui.accent)?;
    set(&mut document, "ui", "density", &values.ui.density)?;
    set(&mut document, "ui", "motion", &values.ui.motion)?;
    set(&mut document, "ui", "language", &values.ui.language)?;
    set(&mut document, "auth", "mode", &values.auth.mode)?;
    set(
        &mut document,
        "jobs",
        "max_concurrency",
        &values.jobs.max_concurrency(),
    )?;
    set(
        &mut document,
        "jobs",
        "lease_seconds",
        &values.jobs.lease_seconds(),
    )?;
    set(&mut document, "logging", "level", &values.logging.level)?;
    set(
        &mut document,
        "logging",
        "retention_days",
        &values.logging.retention_days,
    )?;
    set(&mut document, "notify", "desktop", &values.notify.desktop)?;
    let mut modules = toml_edit::Table::new();
    for (name, config) in &values.modules {
        let mut module = toml_edit::Table::new();
        module.insert("enabled", toml_edit::value(config.enabled));
        modules.insert(name, toml_edit::Item::Table(module));
    }
    document.insert("modules", toml_edit::Item::Table(modules));
    Ok(document.to_string())
}

fn set(
    document: &mut toml_edit::DocumentMut,
    section: &str,
    field: &str,
    value: &impl Serialize,
) -> Result<(), ConfigError> {
    let error = |error: tenon_framework::error::AppError| {
        ConfigError::field(format!("{section}.{field}"), error.to_string())
    };
    let value = persist::encode(value).map_err(error)?;
    persist::set_value(document, section, field, value).map_err(error)
}
