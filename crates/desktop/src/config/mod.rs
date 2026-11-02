//! 严格加载、来源追踪与具体设置事务；运行期仅持有已校验的服务配置。

use std::collections::BTreeMap;

use tenon_framework::{
    cache::CacheConfig, db::DatabaseConfig, i18n::Language, job::JobsConfig,
    logging::LoggingConfig, network::ProxyConfig,
};

mod appearance;
mod backup;
mod loader;
mod module;
mod native;
mod network;
mod persist;
mod settings;
mod source;

pub use appearance::Theme;
pub use backup::{
    BackupAuth, BackupConfig, BackupDatabase, BackupJobs, BackupUi, merge_backup, project_backup,
};
pub use loader::{ConfigError, load};
pub use module::{AuthConfig, AuthMode, ModuleConfig, NotifyConfig};
pub use native::{
    AutostartSettingsChange, CloseAction, NativeConfigSettings, NativeSettingsChange,
    ShortcutSettingsChange, Titlebar, TraySettingsChange, UpdaterSettingsChange,
    WindowSettingsChange,
};
pub use network::NetworkConfigSettings;
pub use settings::{AppSettings, AppSettingsUpdate, SETTINGS_OVERRIDDEN, Setting};
pub use source::ConfigSource;

use appearance::UiConfig;
use native::{AutostartConfig, ShortcutsConfig, TrayConfig, UpdaterConfig, WindowConfig};
use source::ConfigSources;

#[derive(Clone, Debug)]
struct AppConfig {
    notify: NotifyConfig,
    window: WindowConfig,
    tray: TrayConfig,
    autostart: AutostartConfig,
    shortcuts: ShortcutsConfig,
    updater: UpdaterConfig,
    network: ProxyConfig,
    jobs: JobsConfig,
    auth: AuthConfig,
    modules: BTreeMap<String, ModuleConfig>,
    cache: CacheConfig,
    database: DatabaseConfig,
    logging: LoggingConfig,
    ui: UiConfig,
}

/// 宿主共享此对象时应串行化访问；更新方法持有独占借用直到落盘和内存提交完成。
#[derive(Clone, Debug)]
pub struct LoadedConfig {
    values: AppConfig,
    sources: ConfigSources,
}

impl LoadedConfig {
    pub fn notify(&self) -> NotifyConfig {
        self.values.notify
    }

    pub fn language(&self) -> Language {
        self.values.ui.language
    }

    pub fn jobs(&self) -> JobsConfig {
        self.values.jobs
    }

    pub fn auth(&self) -> AuthConfig {
        self.values.auth
    }

    pub fn auth_mode(&self) -> AuthMode {
        self.values.auth.mode
    }

    pub fn modules(&self) -> &BTreeMap<String, ModuleConfig> {
        &self.values.modules
    }

    pub fn cache(&self) -> &CacheConfig {
        &self.values.cache
    }

    pub fn database(&self) -> &DatabaseConfig {
        &self.values.database
    }

    pub fn logging(&self) -> &LoggingConfig {
        &self.values.logging
    }

    pub fn proxy(&self) -> &ProxyConfig {
        &self.values.network
    }

    pub fn file_exists(&self) -> bool {
        self.sources.file_exists
    }

    pub fn source(&self, key: &str) -> ConfigSource {
        self.sources.get(key)
    }

    /// 供宿主记录启动元数据，只返回最终生效的键，不返回配置值。
    pub fn source_keys(&self, source: ConfigSource) -> Vec<&str> {
        self.sources.keys(source)
    }
}

#[cfg(test)]
mod tests;
