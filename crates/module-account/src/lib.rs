//! 唯一所有者账号、认证与应用锁；配置通过宿主注入的端口访问。

mod auth;
mod captcha;
pub mod migrations;
mod password;
mod settings;
mod users;

#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
pub use settings::{AuthMode, AuthPolicy, AuthSettings};

pub use auth::{
    AuthState, AuthStatus, LoginInput, PasswordInput, PasswordProof, RecoverInput, RecoverResult,
    RecoveryCodes, RecoveryRemaining,
};
pub use captcha::{CaptchaAnswer, CaptchaChallenge};
pub use password::hash_password;
pub use users::{CurrentUser, UserPasswordChange, UserProfileUpdate, validate_display_name};

use sea_query::{Expr, ExprTrait, Query};
use std::sync::{Arc, Mutex, OnceLock};
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    cache::Cache,
    db::Db,
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    id::Id,
    module::{Module, ModuleContext, ModuleDeclaration, ModuleExtensions, ModuleFuture},
    param::{ParamDeclaration, ParamEffect, ParamKind, ParamStore},
    time::Timestamp,
};
use users::{USER, User, user_select};

pub const OWNER_INVALID: ErrorCode = ErrorCode::new("account.user.owner_invalid");
pub const AUTH_REQUIRED: ErrorCode = ErrorCode::new("account.auth.required");
pub const INVALID_CREDENTIALS: ErrorCode = ErrorCode::new("account.auth.invalid_credentials");
pub const CAPTCHA_REQUIRED: ErrorCode = ErrorCode::new("account.auth.captcha_required");
pub const CAPTCHA_INVALID: ErrorCode = ErrorCode::new("account.auth.captcha_invalid");
pub const TEMPORARILY_LOCKED: ErrorCode = ErrorCode::new("account.auth.temporarily_locked");
pub const PASSWORD_INVALID: ErrorCode = ErrorCode::new("account.auth.password_invalid");
pub const MODE_CONFLICT: ErrorCode = ErrorCode::new("account.auth.mode_conflict");
pub const INIT_REQUIRED: ErrorCode = ErrorCode::new("account.auth.init_required");
pub const CONFIRM_REQUIRED: ErrorCode = ErrorCode::new("account.auth.confirm_required");
pub const STATE_INVALID: ErrorCode = ErrorCode::new("account.auth.state_invalid");
pub const SESSION_LOCKED: ErrorCode = ErrorCode::new("account.session.locked");
pub const SESSION_EXPIRED: ErrorCode = ErrorCode::new("account.session.expired");
pub const DISPLAY_NAME_INVALID: ErrorCode = ErrorCode::new("account.user.display_name_invalid");

pub const ERROR_CODES: &[ErrorCode] = &[
    OWNER_INVALID,
    AUTH_REQUIRED,
    INVALID_CREDENTIALS,
    CAPTCHA_REQUIRED,
    CAPTCHA_INVALID,
    TEMPORARILY_LOCKED,
    PASSWORD_INVALID,
    MODE_CONFLICT,
    INIT_REQUIRED,
    CONFIRM_REQUIRED,
    STATE_INVALID,
    SESSION_LOCKED,
    SESSION_EXPIRED,
    DISPLAY_NAME_INVALID,
];

pub const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "account",
    version: env!("CARGO_PKG_VERSION"),
    dependencies: &[],
    required_capabilities: &[],
    core: true,
    migrations: migrations::MIGRATIONS,
    error_codes: ERROR_CODES,
    dictionaries: &[],
    permissions: &["account.security.manage"],
    job_kinds: &[],
    schedules: &[],
    params: &[ParamDeclaration {
        key: "account.idle_lock_minutes",
        kind: ParamKind::Integer { min: 1, max: 1440 },
        default: "15",
        group: "account.security",
        order: 10,
        read_permission: None,
        write_permission: Some("account.security.manage"),
        effect: ParamEffect::NextRead,
    }],
    file_purposes: &[],
    message_keys: &[],
};

impl Module for AccountService {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }

    fn extensions(self: Arc<Self>) -> ModuleExtensions {
        ModuleExtensions {
            actor_resolver: Some(self.clone()),
            permission_checker: Some(self.clone()),
            permission_lookup: Some(self),
            ..Default::default()
        }
    }

    fn start<'a>(&'a self, context: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async move {
            let _permit = self
                .operations
                .acquire()
                .await
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            if self.started.get().is_some() {
                return Err(AppError::new(INTERNAL_UNEXPECTED));
            }
            let owner = users::ensure_owner(context.db).await?;
            let state = auth::startup(context.db, owner, self.settings.read()?.mode).await?;
            self.started
                .set(Started {
                    db: context.db.clone(),
                    cache: context.cache.clone(),
                    params: context.params.clone(),
                    owner,
                    permissions: context.permissions.to_vec(),
                    state: Mutex::new(state),
                })
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
        })
    }

    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async move {
            let _permit = self
                .operations
                .acquire()
                .await
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            if let auth::RuntimeState::Login { session: Some(id) } = self.state()? {
                self.expire(&id).await?;
            }
            Ok(())
        })
    }
}

/// 账号数据与认证运行状态的唯一所有者；提供所有者身份与本人安全用例。
pub struct AccountService {
    settings: Arc<dyn AuthSettings>,
    clock: Arc<dyn Fn() -> Timestamp + Send + Sync>,
    operations: tokio::sync::Semaphore,
    started: OnceLock<Started>,
}

struct Started {
    db: tenon_framework::db::Db,
    cache: Cache,
    params: ParamStore,
    owner: Id,
    permissions: Vec<&'static str>,
    state: Mutex<auth::RuntimeState>,
}

impl AccountService {
    /// 只读检查已通过框架 schema 校验的暂存库，包括所有者口令与已使用、软删除的恢复码。
    pub async fn check_restored_password_hashes(db: &Db) -> Result<(), AppError> {
        for query in [
            Query::select()
                .column("password_hash")
                .from(USER.name)
                .and_where(Expr::col("password_hash").is_not_null())
                .to_owned(),
            Query::select()
                .column("code_hash")
                .from("account_recovery_code")
                .to_owned(),
        ] {
            let hashes: Vec<(String,)> = db.fetch_all(&query).await?;
            for (hash,) in hashes {
                password::check_restored_hash(&hash)?;
            }
        }
        Ok(())
    }

    pub fn new(
        settings: Arc<dyn AuthSettings>,
        clock: impl Fn() -> Timestamp + Send + Sync + 'static,
    ) -> Self {
        Self {
            settings,
            clock: Arc::new(clock),
            operations: tokio::sync::Semaphore::new(1),
            started: OnceLock::new(),
        }
    }

    fn started(&self) -> Result<&Started, AppError> {
        self.started
            .get()
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))
    }

    pub fn owner_id(&self) -> Result<Id, AppError> {
        Ok(self.started()?.owner)
    }
}

#[cfg(test)]
mod db;

impl AccountService {
    pub async fn user_me(&self, context: &ExecutionContext) -> Result<CurrentUser, AppError> {
        let Actor::User(id) = context.actor else {
            return Err(AppError::new(INTERNAL_UNEXPECTED));
        };
        let mut query = user_select();
        query.and_where(Expr::col("id").eq(id));
        let user: User = self
            .started()?
            .db
            .fetch_optional(&query)
            .await?
            .ok_or_else(|| AppError::new(OWNER_INVALID))?;
        Ok(CurrentUser {
            id: user.id,
            display_name: user.display_name,
            mode: self.state()?.mode(),
        })
    }
}
