//! 最后一个启动转换唯一构造的运行状态；关闭栈持有同一批服务的实际句柄。

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
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

pub type SharedConfig = Arc<Mutex<LoadedConfig>>;

pub struct AppState {
    pub(crate) native: Arc<crate::native::NativeServices>,
    pub data: tenon_desktop::data::DataService,
    pub workbench: tenon_desktop::workbench::WorkbenchStore,
    pub keyboard: tenon_desktop::keyboard::KeyboardStore,
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

impl tenon_framework::ipc::IpcContext for AppState {
    fn admission(&self) -> &OperationGate {
        &self.gate
    }

    #[expect(
        clippy::expect_used,
        reason = "命令名称由同一 list.rs 生成，入口只传 stringify! 常量"
    )]
    fn command_admission(&self, command: &str) -> tenon_framework::maintenance::CommandAdmission {
        dushan_tenon_lib::contract::COMMAND_ADMISSION
            .iter()
            .find(|(name, _)| *name == command)
            .expect("registered IPC command")
            .1
    }
    fn guard_module(&self, command: &str) -> Result<(), tenon_framework::error::AppError> {
        self.modules.guard(command)
    }
    fn actor_resolver(&self) -> &dyn tenon_framework::ipc::ActorResolver {
        self.identity.actor_resolver.as_ref()
    }
    fn permission_checker(&self) -> &dyn tenon_framework::ipc::PermissionChecker {
        self.identity.permission_checker.as_ref()
    }
    fn required_permissions(&self, command: &str) -> Vec<&'static str> {
        dushan_tenon_lib::contract::COMMAND_PERMISSIONS
            .iter()
            .filter_map(|&(name, permission)| (name == command).then_some(permission))
            .collect()
    }
}

impl AppState {
    pub(crate) fn require_owner(
        &self,
        actor: tenon_framework::actor::Actor,
    ) -> Result<(), tenon_framework::error::AppError> {
        if actor == tenon_framework::actor::Actor::User(self.account.owner_id()?) {
            Ok(())
        } else {
            Err(tenon_framework::error::AppError::new(
                dushan_tenon_lib::contract::OWNER_REQUIRED,
            ))
        }
    }

    pub(crate) async fn setting_for_write(
        &self,
        execution: &tenon_framework::actor::ExecutionContext,
        key: &str,
        row_version: Option<i64>,
    ) -> Result<(), tenon_framework::error::AppError> {
        use tenon_framework::error::{
            AppError, INPUT_INVALID, INTERNAL_UNEXPECTED, PERMISSION_DENIED,
        };
        let declaration = self
            .params
            .declarations()
            .find(|d| d.key == key)
            .ok_or_else(|| AppError::new(INPUT_INVALID).with_param("path", "key"))?;
        let module = declaration
            .key
            .split_once('.')
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?
            .0;
        self.modules.guard(&format!("{module}_setting"))?;
        if row_version.is_some_and(|v| !(1..=9_007_199_254_740_991).contains(&v)) {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "rowVersion"));
        }
        for permission in [declaration.read_permission, declaration.write_permission]
            .into_iter()
            .flatten()
        {
            if !self
                .identity
                .permission_lookup
                .has_permission(execution.actor, permission)
                .await?
            {
                return Err(AppError::new(PERMISSION_DENIED).with_param("permission", permission));
            }
        }
        Ok(())
    }

    pub(crate) async fn setting_entry(
        &self,
        key: &str,
    ) -> Result<tenon_framework::param::ParamEntry, tenon_framework::error::AppError> {
        self.params
            .entries()
            .await?
            .into_iter()
            .find(|entry| entry.key == key)
            .ok_or_else(|| {
                tenon_framework::error::AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED)
            })
    }
}
