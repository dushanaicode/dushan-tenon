//! 非阻塞日志、启动记录与动态级别；启动记录始终写入，级别重载失败返回错误，不依赖其他内核模块。

use std::{
    fs, io,
    num::NonZeroUsize,
    panic,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{Level, Subscriber};
use tracing_appender::{
    non_blocking::WorkerGuard,
    rolling::{RollingFileAppender, Rotation},
};
use tracing_subscriber::{Registry, filter::Targets, layer::SubscriberExt, reload};
use ts_rs::TS;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct LoggingConfig {
    pub level: LogLevel,
    pub retention_days: NonZeroUsize,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: LogLevel::Info,
            retention_days: const { NonZeroUsize::new(14).unwrap() },
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

/// 调用方提供的启动元数据，不携带配置值或秘密。
pub struct StartupRecord {
    pub version: String,
    pub config_file_exists: bool,
    pub environment_keys: Vec<String>,
    pub command_line_keys: Vec<String>,
}

/// 持有日志工作线程；释放时等待缓冲日志刷盘。
pub struct LogGuard {
    _worker: WorkerGuard,
}

const STARTUP_TARGET: &str = concat!(env!("CARGO_CRATE_NAME"), "::startup");

pub struct LogLevelHandle(reload::Handle<Targets, Registry>);

impl LogLevelHandle {
    /// subscriber 已释放或重载锁中毒时返回错误。
    pub fn set_level(&self, level: LogLevel) -> Result<(), LoggingError> {
        self.0
            .reload(level_filter(level))
            .map_err(LoggingError::Reload)
    }
}

fn level_filter(level: LogLevel) -> Targets {
    let level = match level {
        LogLevel::Error => Level::ERROR,
        LogLevel::Warn => Level::WARN,
        LogLevel::Info => Level::INFO,
        LogLevel::Debug => Level::DEBUG,
        LogLevel::Trace => Level::TRACE,
    };
    Targets::new()
        .with_default(level)
        .with_target(STARTUP_TARGET, Level::TRACE)
}

#[derive(Debug, Error)]
pub enum LoggingError {
    #[error("无法更新日志级别: {0}")]
    Reload(#[source] reload::Error),
    #[error("无法创建日志目录 {path}: {source}")]
    Directory { path: PathBuf, source: io::Error },
    #[error("无法初始化日志目录 {path}: {source}")]
    File {
        path: PathBuf,
        source: tracing_appender::rolling::InitError,
    },
    #[error("无法安装日志 subscriber: {0}")]
    Subscriber(#[from] tracing::subscriber::SetGlobalDefaultError),
}

/// 安装一次全局日志与 panic hook；宿主必须持有 guard，并在进程退出前释放它以刷盘。
pub fn init(
    state_root: &Path,
    config: &LoggingConfig,
    startup: &StartupRecord,
) -> Result<(LogGuard, LogLevelHandle), LoggingError> {
    let (subscriber, guard, handle) = build_subscriber(state_root, config)?;
    tracing::subscriber::set_global_default(subscriber)?;
    let previous_hook = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        tracing::error!(panic = %info, "应用 panic");
        previous_hook(info);
    }));
    record_startup(state_root, startup);
    Ok((guard, handle))
}

fn record_startup(state_root: &Path, startup: &StartupRecord) {
    tracing::info!(
        target: STARTUP_TARGET,
        version = %startup.version,
        state_root = %state_root.display(),
        config_file_exists = startup.config_file_exists,
        environment_keys = ?startup.environment_keys,
        command_line_keys = ?startup.command_line_keys,
        "应用启动"
    );
}

fn build_subscriber(
    state_root: &Path,
    config: &LoggingConfig,
) -> Result<
    (
        impl Subscriber + Send + Sync + 'static,
        LogGuard,
        LogLevelHandle,
    ),
    LoggingError,
> {
    let path = state_root.join("logs");
    // appender 在打开文件前先清理旧日志，目录须预先存在。
    fs::create_dir_all(&path).map_err(|source| LoggingError::Directory {
        path: path.clone(),
        source,
    })?;
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("tenon")
        .filename_suffix("jsonl")
        .max_log_files(config.retention_days.get())
        .build(&path)
        .map_err(|source| LoggingError::File { path, source })?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let (filter, handle) = reload::Layer::new(level_filter(config.level));
    // 启动元数据始终记录，普通事件遵循配置级别。
    let subscriber = tracing_subscriber::registry().with(filter).with(
        tracing_subscriber::fmt::layer()
            .json()
            .with_ansi(false)
            .with_writer(writer),
    );
    #[cfg(debug_assertions)]
    let subscriber = subscriber.with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr));
    Ok((
        subscriber,
        LogGuard { _worker: guard },
        LogLevelHandle(handle),
    ))
}

#[cfg(test)]
mod tests;
