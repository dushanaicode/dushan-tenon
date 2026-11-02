mod desktop;
mod quiet;
pub use desktop::{DesktopDelivery, DesktopGate, DesktopNotifier};
pub mod migrations;
mod notifications;
pub use notifications::{
    BuiltinNotificationChannel, DeliveryStatus, NotificationItem, NotificationListInput,
    NotificationReadInput, NotifyTestDesktop, NotifyTestResult,
};

use std::sync::{Arc, OnceLock};

use tenon_framework::{
    db::Db,
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    module::{
        Capability, Module, ModuleContext, ModuleDeclaration, ModuleExtensions, ModuleFuture,
    },
    param::{ParamDeclaration, ParamEffect, ParamKind, ParamStore},
    time::Timestamp,
};
use tenon_module_account::AccountService;

pub const DESKTOP_FAILED: ErrorCode = ErrorCode::new("notify.desktop.failed");
pub const ERROR_CODES: &[ErrorCode] = &[DESKTOP_FAILED];

pub const DICTIONARIES: &[tenon_framework::dict::DictDeclaration] = &[
    tenon_framework::dict::DictDeclaration {
        code: "notify.channel",
        items: BuiltinNotificationChannel::ITEMS,
    },
    tenon_framework::dict::DictDeclaration {
        code: "notify.delivery_status",
        items: DeliveryStatus::ITEMS,
    },
];

pub const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "notify",
    version: env!("CARGO_PKG_VERSION"),
    dependencies: &["account"],
    required_capabilities: &[Capability::Job],
    core: false,
    migrations: migrations::MIGRATIONS,
    error_codes: ERROR_CODES,
    permissions: &[],
    dictionaries: DICTIONARIES,
    params: &[
        ParamDeclaration {
            key: "notify.job_succeeded",
            kind: ParamKind::Boolean,
            default: "true",
            group: "notify.preferences",
            order: 10,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.job_failed",
            kind: ParamKind::Boolean,
            default: "true",
            group: "notify.preferences",
            order: 20,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.job_needs_review",
            kind: ParamKind::Boolean,
            default: "true",
            group: "notify.preferences",
            order: 30,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.desktop_when_focused",
            kind: ParamKind::Boolean,
            default: "true",
            group: "notify.preferences",
            order: 40,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.quiet_enabled",
            kind: ParamKind::Boolean,
            default: "false",
            group: "notify.preferences",
            order: 50,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.quiet_start_hour",
            kind: ParamKind::Integer { min: 0, max: 23 },
            default: "22",
            group: "notify.preferences",
            order: 60,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.quiet_end_hour",
            kind: ParamKind::Integer { min: 0, max: 23 },
            default: "8",
            group: "notify.preferences",
            order: 70,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.in_app_toast",
            kind: ParamKind::Boolean,
            default: "true",
            group: "notify.preferences",
            order: 80,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.toast_seconds",
            kind: ParamKind::Integer { min: 0, max: 60 },
            default: "6",
            group: "notify.preferences",
            order: 90,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.toast_position",
            kind: ParamKind::Choice {
                values: &[
                    "bottom-right",
                    "bottom-left",
                    "bottom-center",
                    "top-right",
                    "top-left",
                    "top-center",
                ],
            },
            default: "bottom-right",
            group: "notify.preferences",
            order: 100,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
        ParamDeclaration {
            key: "notify.retention_days",
            kind: ParamKind::Integer { min: 0, max: 365 },
            default: "0",
            group: "notify.preferences",
            order: 110,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        },
    ],
    file_purposes: &[],
    job_kinds: &[],
    schedules: &[],
    message_keys: &[
        "notify.job.succeeded.title",
        "notify.job.succeeded.body",
        "notify.job.failed.title",
        "notify.job.failed.body",
        "notify.job.needs_review.title",
        "notify.job.needs_review.body",
        "notify.test.title",
        "notify.test.body",
        "notify.settings.test",
        "notify.settings.testResult.sent",
        "notify.settings.testResult.disabled",
        "notify.settings.testResult.failed",
        "notify.toast.view",
        "notify.toast.summary",
    ],
};

impl Module for NotifyService {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }

    fn extensions(self: Arc<Self>) -> ModuleExtensions {
        ModuleExtensions {
            job_completion_hooks: vec![Arc::new(notifications::NotificationHook(self))],
            ..Default::default()
        }
    }

    fn start<'a>(&'a self, context: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async move {
            self.started
                .set(NotifyStarted {
                    db: context.db.clone(),
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

/// 站内持久通知与固定桌面渠道；运行状态不持有队列或完成钩子。
pub struct NotifyService {
    desktop_gate: Arc<dyn DesktopGate>,
    notifier: Arc<dyn DesktopNotifier>,
    clock: Arc<dyn Fn() -> Timestamp + Send + Sync>,
    account: Arc<AccountService>,
    started: OnceLock<NotifyStarted>,
}

struct NotifyStarted {
    db: Db,
    params: ParamStore,
    translator: Arc<dyn tenon_framework::i18n::Translator>,
}

impl NotifyService {
    /// 宿主注入实时桌面开关、系统通知器和时钟。
    pub fn new(
        account: Arc<AccountService>,
        desktop_gate: Arc<dyn DesktopGate>,
        notifier: Arc<dyn DesktopNotifier>,
        clock: impl Fn() -> Timestamp + Send + Sync + 'static,
    ) -> Self {
        Self {
            account,
            desktop_gate,
            notifier,
            clock: Arc::new(clock),
            started: OnceLock::new(),
        }
    }

    fn started(&self) -> Result<&NotifyStarted, AppError> {
        self.started
            .get()
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))
    }
}

#[cfg(test)]
mod db;
#[cfg(test)]
mod test_support;
