//! IPC 的纯数据合同；生成工具不加载 Tauri 运行状态或业务服务。

use serde::{Deserialize, Serialize};
pub use tenon_desktop::{
    config::{AppSettings, AppSettingsUpdate},
    data::{DataStatus, FileArtifact, OperationProgress, RestoreAccepted, RestorePlan},
    file_ingress::{FileIngressClaim, FileIngressDismiss, FileIngressId, FileIngressSnapshot},
    keyboard::{KeyboardSettings, KeyboardUpdate},
    network::{NetworkSettings, NetworkSettingsUpdate},
    picked_files::{FilePickInput, FilePicked},
    workbench::{WorkbenchResetLayout, WorkbenchSnapshot, WorkbenchUpdate},
};
use tenon_framework::{cache::CacheProvider, db::DatabaseKind, id::Id, module::ModuleInfo};
pub use tenon_framework::{
    db::Page,
    job::{JobEvent, JobId, JobSnapshot, JobSubmitted},
    maintenance::CommandAdmission,
    param::ParamEntry,
    stream::StreamCancel,
};
pub use tenon_module_account::{
    AuthStatus, CaptchaChallenge, CurrentUser, LoginInput, PasswordInput, PasswordProof,
    RecoverInput, RecoverResult, RecoveryCodes, RecoveryRemaining, UserPasswordChange,
    UserProfileUpdate,
};
pub use tenon_module_demo::{
    DemoDraftLease, DemoDraftOpen, DemoDraftSaved, DemoDraftWrite, DemoListInput, DemoMeasureInput,
    DemoOverview, DemoSample, DemoSampleCreate, DemoSampleDraft, DemoSampleId, DemoSampleUpdate,
    DemoSampleVersion,
};
pub use tenon_module_devtools::{
    JobDetail, JobListInput, JobResolve, JobSummary, ScheduleId, ScheduleSnapshot,
};
pub use tenon_module_files::file::{
    FileDelete, FileId, FileListInput, FilePreview, FilePurposes, FileSummary, FileTextPage,
    FileTextPageInput, ReclaimReport,
};
pub use tenon_module_notify::{
    NotificationItem, NotificationListInput, NotificationReadInput, NotifyTestResult,
};
use ts_rs::TS;

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileAddInput {
    pub purpose: String,
    pub file_token: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSaveInput {
    pub id: Id,
    pub file_token: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoAttachmentAdd {
    pub id: Id,
    #[ts(type = "number")]
    pub row_version: i64,
    pub file_token: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoAttachmentSave {
    pub id: Id,
    pub file_token: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationCancelInput {
    pub operation_id: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveOperationInput {
    pub file_token: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreCommitInput {
    pub prepared_id: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticExportInput {
    pub file_token: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoExportInput {
    pub file_token: String,
    pub format: tenon_framework::exchange::ExchangeFormat,
    #[ts(optional)]
    pub keyword: Option<String>,
    #[ts(optional)]
    pub stage: Option<tenon_module_demo::DemoSampleStage>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoImportInput {
    pub file_token: String,
    pub mode: tenon_module_demo::DemoImportMode,
}

pub const IPC_UNEXPECTED: tenon_framework::error::ErrorCode =
    tenon_framework::error::ErrorCode::new("app.ipc.unexpected");
pub const OWNER_REQUIRED: tenon_framework::error::ErrorCode =
    tenon_framework::error::ErrorCode::new("app.native.owner_required");

pub use tenon_desktop::{
    config::NativeSettingsChange,
    native::{
        opener::OpenKnownTargetInput,
        window_controls::{WindowCloseDecision, WindowEditDecision, WindowEditState, WindowEvent},
    },
};

pub const WINDOW_STATE_INVALID: tenon_framework::error::ErrorCode =
    tenon_framework::error::ErrorCode::new("app.window_state.invalid");
pub const WINDOW_STATE_WRITE_FAILED: tenon_framework::error::ErrorCode =
    tenon_framework::error::ErrorCode::new("app.window_state.write_failed");

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeSettings {
    pub can_edit: bool,
    pub updater: UpdaterSettings,
    pub tray: tenon_desktop::native::tray::TraySettings,
    pub window: NativeWindowSettings,
    pub autostart: tenon_desktop::native::autostart::AutostartSettings,
    pub shortcut: tenon_desktop::native::shortcuts::ShortcutSettings,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSettings {
    pub check_on_start: tenon_desktop::config::Setting<bool>,
    pub configured: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeWindowSettings {
    pub restore_state: tenon_desktop::config::Setting<bool>,
    pub state: WindowRestoreState,
    pub error: Option<tenon_framework::error::IpcError>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum WindowRestoreState {
    FirstRun,
    Restored,
    Disabled,
    Failed,
}

macro_rules! app_commands {
    ($([$admission:ident] $level:ident $(($($permission:literal),+))? $command:ident ($($input:ty)? $(; $event:ty)?) => $output:ty),* $(,)?) => {
        pub const COMMAND_NAMES: &[&str] = &[$(stringify!($command)),*];
        pub const COMMAND_ACCESS: &[(&str, &str)] = &[$((stringify!($command), stringify!($level))),*];
        pub const COMMAND_ADMISSION: &[(&str, CommandAdmission)] = &[$((stringify!($command), app_commands!(@admission $admission))),*];
        pub const COMMAND_PERMISSIONS: &[(&str, &str)] = &[$($($((stringify!($command), $permission),)+)?)*];
    };
    (@admission normal) => { CommandAdmission::Normal };
    (@admission maintenance) => { CommandAdmission::Maintenance };
    (@admission control) => { CommandAdmission::Control };
}
include!("commands/list.rs");

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingListInput {
    pub include_disabled: bool,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingSetInput {
    pub key: String,
    pub value: String,
    #[ts(type = "number | null")]
    pub row_version: Option<i64>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingResetInput {
    pub key: String,
    #[ts(type = "number | null")]
    pub row_version: Option<i64>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppAbout {
    pub version: String,
    pub state_root: String,
    pub config_file: String,
    pub config_file_exists: bool,
    pub log_directory: String,
    pub database_kind: DatabaseKind,
    pub database_location: String,
    pub applied_migrations: u32,
    pub cache_provider: CacheProvider,
    pub cache_location: Option<String>,
    pub cache_status: CacheStatus,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum CacheStatus {
    Connected,
    Error { code: String },
}

#[derive(Debug, Serialize, TS)]
pub struct AppModules {
    pub modules: Vec<ModuleInfo>,
}
