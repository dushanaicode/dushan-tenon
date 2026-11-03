mod attachments;
mod drafts;
mod exchange;
mod jobs;
pub mod migrations;
mod samples;
mod types;

pub use types::*;

use std::{
    error::Error as _,
    sync::{Arc, OnceLock},
};

use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::Db,
    error::{AppError, ErrorCode, INPUT_INVALID, INTERNAL_UNEXPECTED},
    file::FileStore,
    i18n::{Language, Translator},
    id::Id,
    module::{
        Capability, Module, ModuleContext, ModuleDeclaration, ModuleExtensions, ModuleFuture,
    },
    param::{ParamDeclaration, ParamEffect, ParamKind, ParamStore},
};
use tenon_module_account::AccountService;

pub const MODE_DISABLED: ErrorCode = ErrorCode::new("demo.mode.disabled");
pub const SAMPLE_NOT_FOUND: ErrorCode = ErrorCode::new("demo.sample.not_found");
pub const CODE_CONFLICT: ErrorCode = ErrorCode::new("demo.sample.code_conflict");
pub const ATTACHMENT_EXISTS: ErrorCode = ErrorCode::new("demo.attachment.exists");
pub const DRAFT_EXPIRED: ErrorCode = ErrorCode::new("demo.draft.expired");
pub const DRAFT_LIMIT: ErrorCode = ErrorCode::new("demo.draft.limit");
pub const ERROR_CODES: &[ErrorCode] = &[
    MODE_DISABLED,
    SAMPLE_NOT_FOUND,
    CODE_CONFLICT,
    ATTACHMENT_EXISTS,
    DRAFT_EXPIRED,
    DRAFT_LIMIT,
];

pub const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "demo",
    version: env!("CARGO_PKG_VERSION"),
    dependencies: &["account"],
    required_capabilities: &[Capability::Job, Capability::Exchange, Capability::File],
    core: false,
    migrations: migrations::MIGRATIONS,
    error_codes: ERROR_CODES,
    permissions: &[
        "demo.sample.read",
        "demo.sample.write",
        "demo.sample.import",
        "demo.sample.export",
        "demo.sample.run",
        "demo.settings.manage",
    ],
    dictionaries: &[tenon_framework::dict::DictDeclaration {
        code: "demo.sample_stage",
        items: DemoSampleStage::ITEMS,
    }],
    params: &[ParamDeclaration {
        key: "demo.batch_size",
        kind: ParamKind::Integer { min: 1, max: 100 },
        default: "25",
        group: "demo.work",
        order: 10,
        read_permission: Some("demo.settings.manage"),
        write_permission: Some("demo.settings.manage"),
        effect: ParamEffect::NextJob,
    }],
    file_purposes: &[tenon_framework::file::FilePurposeDeclaration {
        code: "demo.attachment",
        extensions: &["txt", "md", "png", "pdf"],
    }],
    job_kinds: &["demo.measure", "demo.sample_import", "demo.sample_export"],
    schedules: &[],
    message_keys: &[
        "jobs.kinds.demo.measure",
        "jobs.kinds.demo.sample_import",
        "jobs.kinds.demo.sample_export",
        "demo.progress.measure",
        "demo.sample.code",
        "demo.sample.title",
        "demo.sample.note",
        "demo.sample.stage",
        "exchange.progress.exporting",
        "exchange.progress.validating",
        "exchange.progress.writing",
    ],
};

/// 宿主在每个用户用例开始时提供的当前偏好。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DemoPreferences {
    pub developer_mode: bool,
    pub language: Language,
}

pub struct DemoService {
    preferences: Arc<dyn Fn() -> Result<DemoPreferences, AppError> + Send + Sync>,
    account: Arc<AccountService>,
    started: Arc<OnceLock<DemoStarted>>,
}

struct DemoStarted {
    db: Db,
    files: FileStore,
    params: ParamStore,
    translator: Arc<dyn Translator>,
}

impl DemoService {
    pub fn new(
        account: Arc<AccountService>,
        preferences: Arc<dyn Fn() -> Result<DemoPreferences, AppError> + Send + Sync>,
    ) -> Self {
        Self {
            account,
            preferences,
            started: Arc::new(OnceLock::new()),
        }
    }

    fn started(&self) -> Result<&DemoStarted, AppError> {
        self.started
            .get()
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))
    }

    // 模块/权限由统一 IPC 入口核验；提交时语言与模式来自同一次偏好读取。
    fn enter(&self, context: &ExecutionContext) -> Result<(Id, DemoPreferences), AppError> {
        let preferences = (self.preferences)()?;
        if !preferences.developer_mode {
            return Err(AppError::new(MODE_DISABLED));
        }
        Ok((user(context)?, preferences))
    }
}

impl Module for DemoService {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }

    fn extensions(self: Arc<Self>) -> ModuleExtensions {
        // 处理器仅持启动资源和所需句柄，不持服务/Extensions/JobQueue，避免环。
        ModuleExtensions {
            job_handlers: vec![Arc::new(jobs::Measure {
                started: self.started.clone(),
                account: self.account.clone(),
            })],
            ..Default::default()
        }
    }

    fn start<'a>(&'a self, context: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async move {
            self.started
                .set(DemoStarted {
                    db: context.db.clone(),
                    files: context.files.clone(),
                    params: context.params.clone(),
                    translator: context.translator.clone(),
                })
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
        })
    }

    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}

fn user(context: &ExecutionContext) -> Result<Id, AppError> {
    match context.actor {
        Actor::User(id) => Ok(id),
        Actor::System => Err(AppError::new(INTERNAL_UNEXPECTED)),
    }
}

fn invalid(path: &'static str) -> AppError {
    AppError::new(INPUT_INVALID).with_param("path", path)
}

// 底层 SQL/磁盘错误的 source 可能含业务值或路径，不能进入宿主运行日志。
fn safe_error(error: AppError) -> AppError {
    if error.source().is_some() {
        AppError::new(error.code())
    } else {
        error
    }
}

#[cfg(test)]
mod db;
