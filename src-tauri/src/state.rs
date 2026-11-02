//! 最后一个启动转换唯一构造的运行状态；关闭栈持有同一批服务的实际句柄。

use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tenon_desktop::{config::LoadedConfig, picked_files::PickedFileStore};
use tenon_framework::{
    cache::Cache,
    db::{Db, migrate::MigrationStatus},
    file::FileStore,
    instance::InstanceId,
    job::JobQueue,
    logging::LogLevelHandle,
    maintenance::OperationGate,
    module::{Identity, ModuleRegistry},
    network::ProxySecrets,
    param::ParamStore,
    stream::StreamRegistry,
};
use tenon_module_account::AccountService;
use tenon_module_ai::AiService;
use tenon_module_demo::DemoService;
use tenon_module_notify::NotifyService;

pub type SharedConfig = Arc<RwLock<LoadedConfig>>;

pub struct AppState {
    pub state_root: PathBuf,
    pub overrides: Vec<String>,
    pub ephemeral_webview: bool,
    pub config: SharedConfig,
    pub log_level: LogLevelHandle,
    pub instance: InstanceId,
    pub db: Db,
    pub migrations: MigrationStatus,
    pub cache: Cache,
    pub params: ParamStore,
    pub files: FileStore,
    pub picked_files: Arc<PickedFileStore>,
    pub modules: Arc<ModuleRegistry>,
    pub identity: Identity,
    pub jobs: JobQueue,
    pub account: Arc<AccountService>,
    pub notify: Arc<NotifyService>,
    pub ai: Arc<AiService>,
    pub demo: Arc<DemoService>,
    pub network_secrets: Arc<ProxySecrets>,
    pub gate: OperationGate,
    pub streams: StreamRegistry,
}
