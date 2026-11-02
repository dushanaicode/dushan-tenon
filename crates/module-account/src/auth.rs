use std::{future::Future, pin::Pin, time::Duration};

use sea_query::{Expr, ExprTrait, Value};
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::{Db, Table, Tx, select},
    error::{AppError, INTERNAL_UNEXPECTED},
    id::Id,
    ipc::{ActiveActor, ActorResolver},
    time::Timestamp,
};
use ts_rs::TS;
use uuid::Uuid;

use crate::{
    AUTH_REQUIRED, AccountService, AuthMode, CONFIRM_REQUIRED, CaptchaAnswer, CurrentUser,
    INIT_REQUIRED, INVALID_CREDENTIALS, MODE_CONFLICT, SESSION_EXPIRED, SESSION_LOCKED,
    STATE_INVALID, USER, User, password, user_select,
};

pub(super) mod attempt;
mod recovery;

const SETTING: Table = Table {
    name: "account_auth_setting",
    audit: true,
    soft_delete: false,
    optimistic_lock: true,
};
const RECOVERY: Table = Table {
    name: "account_recovery_code",
    audit: true,
    soft_delete: true,
    optimistic_lock: false,
};
const SESSION_NS: &str = "account.session";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum RuntimeState {
    None,
    InitRequired,
    ConfirmRequired,
    Login { session: Option<String> },
}

impl RuntimeState {
    pub(super) fn mode(&self) -> AuthMode {
        match self {
            Self::None | Self::ConfirmRequired => AuthMode::None,
            Self::InitRequired | Self::Login { .. } => AuthMode::Login,
        }
    }
}

#[derive(Debug, Serialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthState {
    Active,
    Anonymous,
    Locked,
    InitRequired,
    ConfirmRequired,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub mode: AuthMode,
    pub state: AuthState,
    pub user: Option<CurrentUser>,
    pub permissions: Vec<String>,
    #[ts(type = "number")]
    pub idle_lock_minutes: i64,
}

// 密码和一次性恢复码不实现 Debug，避免进入诊断输出。
#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PasswordInput {
    pub password: String,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PasswordProof {
    pub password: String,
    #[ts(optional)]
    pub captcha: Option<CaptchaAnswer>,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct LoginInput {
    pub password: String,
    #[ts(optional)]
    pub captcha: Option<CaptchaAnswer>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoverInput {
    pub recovery_code: String,
    pub new_password: String,
    #[ts(optional)]
    pub captcha: Option<CaptchaAnswer>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecoverResult {
    pub remaining_codes: u32,
}

#[derive(Serialize, TS)]
pub struct RecoveryRemaining {
    pub remaining: u32,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCodes {
    pub recovery_codes: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Session {
    user_id: Id,
    created_at: Timestamp,
    last_activity_at: Timestamp,
    locked: bool,
}

#[derive(sqlx::FromRow)]
struct AuthSetting {
    id: Id,
    mode: String,
    row_version: i64,
}

fn setting(rows: &[AuthSetting]) -> Result<&AuthSetting, AppError> {
    match rows {
        [row] if row.mode == "none" || row.mode == "login" => Ok(row),
        _ => Err(AppError::new(STATE_INVALID)),
    }
}

fn user_query(id: Id) -> sea_query::SelectStatement {
    let mut query = user_select();
    query.and_where(Expr::col("id").eq(id));
    query
}

pub(super) async fn startup(db: &Db, owner: Id, mode: AuthMode) -> Result<RuntimeState, AppError> {
    let mut tx = db.begin().await?;
    // 锁定已有所有者，串行化多个进程首次创建唯一的模式记录。
    let user: User = tx
        .fetch_optional(&user_query(owner).lock_exclusive().to_owned())
        .await?
        .ok_or_else(|| AppError::new(STATE_INVALID))?;
    let rows: Vec<AuthSetting> = tx.fetch_all(&select(SETTING).into_query()).await?;
    let db_mode = if rows.is_empty() {
        let mode = mode_name(mode);
        tx.insert(
            SETTING,
            &ExecutionContext::new(Actor::System, "system-start"),
            [("mode", mode.into())],
        )
        .await?;
        mode
    } else {
        &setting(&rows)?.mode
    };
    let state = match (mode, db_mode, user.password_hash.is_some()) {
        (AuthMode::None, "none", _) => RuntimeState::None,
        (AuthMode::None, "login", true) => RuntimeState::ConfirmRequired,
        (AuthMode::None, "login", false) => return Err(AppError::new(STATE_INVALID)),
        (AuthMode::Login, _, false) => RuntimeState::InitRequired,
        (AuthMode::Login, _, true) => {
            if db_mode == "none" {
                let row = setting(&rows)?;
                tx.update_by_id(
                    SETTING,
                    &ExecutionContext::new(Actor::System, "system-start"),
                    row.id,
                    Some(row.row_version),
                    [("mode", "login".into())],
                )
                .await?;
            }
            RuntimeState::Login { session: None }
        }
        _ => return Err(AppError::new(STATE_INVALID)),
    };
    tx.commit().await?;
    Ok(state)
}

fn mode_name(mode: AuthMode) -> &'static str {
    match mode {
        AuthMode::None => "none",
        AuthMode::Login => "login",
    }
}

impl AccountService {
    pub(super) fn state(&self) -> Result<RuntimeState, AppError> {
        Ok(self
            .started()?
            .state
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .clone())
    }

    fn set_state(&self, state: RuntimeState) -> Result<(), AppError> {
        *self
            .started()?
            .state
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))? = state;
        Ok(())
    }

    async fn user(&self, id: Id) -> Result<User, AppError> {
        self.started()?
            .db
            .fetch_optional(&user_query(id))
            .await?
            .ok_or_else(|| AppError::new(STATE_INVALID))
    }

    pub(super) async fn expire(&self, id: &str) -> Result<(), AppError> {
        let started = self.started()?;
        {
            let mut state = started
                .state
                .lock()
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            // 先撤销运行态引用；缓存删除失败也不能继续使用已失效凭据。
            // 并发解析旧会话不得清除新登录。
            if let RuntimeState::Login { session } = &mut *state
                && session.as_deref() == Some(id)
            {
                *session = None;
            }
        }
        started.cache.delete(SESSION_NS, id).await
    }

    async fn clear_session(&self) -> Result<(), AppError> {
        if let RuntimeState::Login { session: Some(id) } = self.state()? {
            self.expire(&id).await?;
        }
        Ok(())
    }

    fn remaining(&self, session: &Session) -> Result<i64, AppError> {
        Ok(
            session.created_at.as_millis() + self.settings.read()?.session_max_hours * 3_600_000
                - (self.clock)().as_millis(),
        )
    }

    async fn save_session(&self, id: &str, session: &Session) -> Result<(), AppError> {
        let remaining = self.remaining(session)?;
        if remaining <= 0 {
            self.expire(id).await?;
            return Err(AppError::new(SESSION_EXPIRED));
        }
        self.started()?
            .cache
            .set_json(
                SESSION_NS,
                id,
                session,
                Duration::from_millis(remaining as u64),
            )
            .await
    }

    async fn session(&self, allow_locked: bool) -> Result<(String, Session, User), AppError> {
        let id = match self.state()? {
            RuntimeState::Login { session: Some(id) } => id,
            RuntimeState::Login { session: None } => return Err(AppError::new(AUTH_REQUIRED)),
            _ => return Err(AppError::new(MODE_CONFLICT)),
        };
        let cached: Option<Session> = self.started()?.cache.get_json(SESSION_NS, &id).await?;
        let Some(mut session) = cached else {
            self.expire(&id).await?;
            return Err(AppError::new(SESSION_EXPIRED));
        };
        if self.remaining(&session)? <= 0 {
            self.expire(&id).await?;
            return Err(AppError::new(SESSION_EXPIRED));
        }
        let idle_ms = self
            .started()?
            .params
            .int("account.idle_lock_minutes")
            .await?
            * 60_000;
        session.locked = session.locked
            || (self.clock)().as_millis() - session.last_activity_at.as_millis() >= idle_ms;
        if session.locked && !allow_locked {
            return Err(AppError::new(SESSION_LOCKED));
        }
        let user: Option<User> = self
            .started()?
            .db
            .fetch_optional(&user_query(session.user_id))
            .await?;
        match user {
            Some(user) if user.id == self.started()?.owner => Ok((id, session, user)),
            _ => {
                self.expire(&id).await?;
                Err(AppError::new(SESSION_EXPIRED))
            }
        }
    }

    pub(super) async fn resolve(&self, allow_locked: bool) -> Result<Actor, AppError> {
        match self.state()? {
            RuntimeState::None => Ok(Actor::User(self.started()?.owner)),
            RuntimeState::InitRequired => Err(AppError::new(INIT_REQUIRED)),
            RuntimeState::ConfirmRequired => Err(AppError::new(CONFIRM_REQUIRED)),
            RuntimeState::Login { .. } => Ok(Actor::User(self.session(allow_locked).await?.2.id)),
        }
    }

    pub(super) async fn active_actor(&self) -> Result<ActiveActor, AppError> {
        Ok(ActiveActor {
            actor: self.resolve(false).await?,
            permissions: self.permissions()?,
        })
    }

    fn permissions(&self) -> Result<Vec<String>, AppError> {
        Ok(self
            .started()?
            .permissions
            .iter()
            .map(|key| (*key).to_owned())
            .collect())
    }

    async fn create_session(&self, user: &User) -> Result<(), AppError> {
        let id = Uuid::new_v4().to_string();
        let now = (self.clock)();
        self.save_session(
            &id,
            &Session {
                user_id: user.id,
                created_at: now,
                last_activity_at: now,
                locked: false,
            },
        )
        .await?;
        if let RuntimeState::Login { session: Some(old) } = self.state()?
            && let Err(error) = self.started()?.cache.delete(SESSION_NS, &old).await
        {
            self.started()?.cache.delete(SESSION_NS, &id).await?;
            return Err(error);
        }
        self.set_state(RuntimeState::Login { session: Some(id) })
    }

    pub async fn auth_status(&self) -> Result<AuthStatus, AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let runtime = self.state()?;
        let mode = runtime.mode();
        let (state, user) = match runtime {
            RuntimeState::None => (
                AuthState::Active,
                Some(self.user(self.started()?.owner).await?),
            ),
            RuntimeState::InitRequired => (AuthState::InitRequired, None),
            RuntimeState::ConfirmRequired => (AuthState::ConfirmRequired, None),
            RuntimeState::Login { session: None } => (AuthState::Anonymous, None),
            RuntimeState::Login { session: Some(_) } => match self.session(true).await {
                Ok((_, session, user)) => (
                    if session.locked {
                        AuthState::Locked
                    } else {
                        AuthState::Active
                    },
                    Some(user),
                ),
                Err(error) if error.code() == SESSION_EXPIRED => (AuthState::Anonymous, None),
                Err(error) => return Err(error),
            },
        };
        let permissions = match &user {
            Some(_) => self.permissions()?,
            None => Vec::new(),
        };
        Ok(AuthStatus {
            mode,
            state,
            permissions,
            user: user.map(|user| CurrentUser {
                id: user.id,
                display_name: user.display_name,
                mode,
            }),
            idle_lock_minutes: self
                .started()?
                .params
                .int("account.idle_lock_minutes")
                .await?,
        })
    }

    pub async fn login(&self, input: LoginInput) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if !matches!(self.state()?, RuntimeState::Login { .. }) {
            return Err(AppError::new(MODE_CONFLICT));
        }
        let user = self.user(self.started()?.owner).await?;
        self.check_password(
            &user,
            PasswordProof {
                password: input.password,
                captcha: input.captcha,
            },
        )
        .await?;
        self.create_session(&user).await
    }

    pub async fn logout(&self, context: &ExecutionContext) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let (id, _, user) = self.session(true).await?;
        if context.actor != Actor::User(user.id) {
            return Err(AppError::new(SESSION_EXPIRED));
        }
        self.expire(&id).await
    }

    pub async fn lock(&self) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let (id, mut session, _) = self.session(true).await?;
        session.locked = true;
        self.save_session(&id, &session).await
    }

    pub async fn touch(&self) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let (id, mut session, _) = self.session(false).await?;
        session.last_activity_at = (self.clock)();
        self.save_session(&id, &session).await
    }

    pub async fn unlock(
        &self,
        context: &ExecutionContext,
        input: PasswordProof,
    ) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let (id, mut session, user) = self.session(true).await?;
        if context.actor != Actor::User(user.id) {
            return Err(AppError::new(SESSION_EXPIRED));
        }
        self.check_password(&user, input).await?;
        // 哈希期间可能到期；save_session 再次检查绝对期限。
        session.locked = false;
        session.last_activity_at = (self.clock)();
        self.save_session(&id, &session).await
    }

    async fn check_password(&self, user: &User, input: PasswordProof) -> Result<(), AppError> {
        self.attempt(input.captcha, async {
            if password::verify(input.password.into(), user.password_hash.clone()).await? {
                Ok(())
            } else {
                Err(AppError::new(INVALID_CREDENTIALS))
            }
        })
        .await
    }

    pub async fn user_password_change(
        &self,
        context: &ExecutionContext,
        input: crate::UserPasswordChange,
    ) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let (_, _, user) = self.session(false).await?;
        if context.actor != Actor::User(user.id) {
            return Err(AppError::new(SESSION_EXPIRED));
        }
        password::validate(&input.new_password)?;
        self.check_password(
            &user,
            PasswordProof {
                password: input.current_password,
                captcha: input.captcha,
            },
        )
        .await?;
        let hash = password::hash_password(input.new_password.into()).await?;
        // rowVersion 保证凭据更新不会覆盖读快照后的写入。
        self.started()?
            .db
            .update_by_id(
                USER,
                context,
                user.id,
                Some(user.row_version),
                [("password_hash", hash.expose_secret().into())],
            )
            .await?;
        self.clear_session().await?;
        self.create_session(&user).await
    }

    async fn persist_mode(
        &self,
        context: &ExecutionContext,
        owner: &User,
        credentials: Option<&password::Credentials>,
    ) -> Result<(), AppError> {
        let mut tx = self.started()?.db.begin().await?;
        tx.update_by_id(
            USER,
            context,
            owner.id,
            Some(owner.row_version),
            [(
                "password_hash",
                credentials.map_or(Value::String(None), |value| {
                    value.password_hash.clone().into()
                }),
            )],
        )
        .await?;
        replace_recovery(
            &mut tx,
            context,
            owner.id,
            credentials.map_or(&[], |value| value.hashes.as_slice()),
        )
        .await?;
        let rows: Vec<AuthSetting> = tx.fetch_all(&select(SETTING).into_query()).await?;
        let row = setting(&rows)?;
        tx.update_by_id(
            SETTING,
            context,
            row.id,
            Some(row.row_version),
            [(
                "mode",
                if credentials.is_some() {
                    "login"
                } else {
                    "none"
                }
                .into(),
            )],
        )
        .await?;
        tx.commit().await
    }

    async fn change_mode(
        &self,
        context: &ExecutionContext,
        owner: &User,
        credentials: Option<&password::Credentials>,
        write_config: bool,
    ) -> Result<(), AppError> {
        let mode = if credentials.is_some() {
            AuthMode::Login
        } else {
            AuthMode::None
        };
        let previous = self.settings.read()?.mode;
        if write_config {
            self.settings.set_mode(mode)?;
        }
        // 将数据库事务 future 的布局隔离，避免宿主 release 命令的嵌套布局超过编译器深度。
        if let Err(error) = Box::pin(self.persist_mode(context, owner, credentials)).await {
            if write_config && let Err(rollback) = self.settings.set_mode(previous) {
                return Err(
                    AppError::new(INTERNAL_UNEXPECTED).with_source(std::io::Error::other(format!(
                        "认证事务失败 ({})，配置回滚失败 ({})",
                        error.code(),
                        rollback.code()
                    ))),
                );
            }
            return Err(error);
        }
        Ok(())
    }

    pub async fn enable_login(
        &self,
        context: &ExecutionContext,
        password: String,
    ) -> Result<RecoveryCodes, AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if self.state()? != RuntimeState::None {
            return Err(AppError::new(MODE_CONFLICT));
        }
        self.initialize_owner(context, password, true).await
    }

    pub async fn initialize(
        &self,
        password: String,
        trace_id: &str,
    ) -> Result<RecoveryCodes, AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if self.state()? != RuntimeState::InitRequired {
            return Err(AppError::new(MODE_CONFLICT));
        }
        self.initialize_owner(
            &ExecutionContext::new(Actor::User(self.started()?.owner), trace_id),
            password,
            false,
        )
        .await
    }

    async fn initialize_owner(
        &self,
        context: &ExecutionContext,
        password: String,
        write_config: bool,
    ) -> Result<RecoveryCodes, AppError> {
        let owner = self.user(self.started()?.owner).await?;
        let credentials = password::create(password.into()).await?;
        self.change_mode(context, &owner, Some(&credentials), write_config)
            .await?;
        self.set_state(RuntimeState::Login { session: None })?;
        self.create_session(&owner).await?;
        Ok(RecoveryCodes {
            recovery_codes: credentials.codes,
        })
    }

    pub async fn disable_login(
        &self,
        context: &ExecutionContext,
        input: PasswordProof,
    ) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if !matches!(self.state()?, RuntimeState::Login { .. })
            || context.actor != Actor::User(self.started()?.owner)
        {
            return Err(AppError::new(MODE_CONFLICT));
        }
        let (id, _, owner) = self.session(false).await?;
        if owner.id != self.started()?.owner {
            return Err(AppError::new(MODE_CONFLICT));
        }
        self.check_password(&owner, input).await?;
        self.change_mode(context, &owner, None, true).await?;
        let deleted = self.started()?.cache.delete(SESSION_NS, &id).await;
        // 数据库已提交，即使缓存故障也不能保留旧的运行模式。
        self.set_state(RuntimeState::None)?;
        deleted
    }

    pub async fn confirm_mode(&self, input: PasswordProof, trace_id: &str) -> Result<(), AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if self.state()? != RuntimeState::ConfirmRequired {
            return Err(AppError::new(MODE_CONFLICT));
        }
        let owner = self.user(self.started()?.owner).await?;
        self.check_password(&owner, input).await?;
        self.change_mode(
            &ExecutionContext::new(Actor::User(owner.id), trace_id),
            &owner,
            None,
            false,
        )
        .await?;
        self.set_state(RuntimeState::None)
    }
}

async fn replace_recovery(
    tx: &mut Tx<'_>,
    context: &ExecutionContext,
    user_id: Id,
    hashes: &[String],
) -> Result<(), AppError> {
    let mut query = select(RECOVERY).into_query();
    query
        .clear_selects()
        .column("id")
        .and_where(Expr::col("user_id").eq(user_id))
        .lock_exclusive();
    let old: Vec<(Id,)> = tx.fetch_all(&query).await?;
    for (id,) in old {
        tx.soft_delete_by_id(RECOVERY, context, id, None).await?;
    }
    for hash in hashes {
        tx.insert(
            RECOVERY,
            context,
            [
                ("user_id", user_id.into()),
                ("code_hash", hash.clone().into()),
                ("used_at", Value::BigInt(None)),
            ],
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
pub(super) mod db;

impl ActorResolver for AccountService {
    fn resolve_active(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<ActiveActor, AppError>> + Send + '_>> {
        Box::pin(self.active_actor())
    }
    fn resolve_session(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Actor, AppError>> + Send + '_>> {
        Box::pin(self.resolve(true))
    }
    fn resolve_public(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Actor>, AppError>> + Send + '_>> {
        Box::pin(async {
            match self.resolve(false).await {
                Ok(actor) => Ok(Some(actor)),
                Err(error)
                    if [
                        AUTH_REQUIRED,
                        INIT_REQUIRED,
                        CONFIRM_REQUIRED,
                        SESSION_LOCKED,
                        SESSION_EXPIRED,
                    ]
                    .contains(&error.code()) =>
                {
                    Ok(None)
                }
                Err(error) => Err(error),
            }
        })
    }
}

impl AccountService {
    pub async fn with_active_user<T: Send>(
        &self,
        recipient: Id,
        work: impl FnOnce() -> Result<T, AppError> + Send,
    ) -> Result<Option<T>, AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if self.resolve_public().await? != Some(Actor::User(recipient)) {
            return Ok(None);
        }
        work().map(Some)
    }
}
