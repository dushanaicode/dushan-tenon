use super::{AccountService, DISPLAY_NAME_INVALID, OWNER_INVALID};
use sea_query::{Expr, ExprTrait, Value};
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::{Db, Table, Tx, select},
    error::{AppError, DATA_NOT_FOUND, INTERNAL_UNEXPECTED},
    id::Id,
    ipc::{ActiveActor, PermissionChecker},
};
mod types;
pub use types::*;

pub(super) const USER: Table = Table {
    name: "account_user",
    audit: true,
    soft_delete: false,
    optimistic_lock: true,
};

#[derive(sqlx::FromRow)]
pub(super) struct User {
    pub(super) id: Id,
    pub(super) display_name: String,
    pub(super) password_hash: Option<String>,
    pub(super) row_version: i64,
}

const USER_COLUMNS: [&str; 4] = ["id", "display_name", "password_hash", "row_version"];

pub(super) fn user_select() -> sea_query::SelectStatement {
    select(USER)
        .into_query()
        .clear_selects()
        .columns(USER_COLUMNS.map(|column| (USER.name, column)))
        .to_owned()
}

pub(super) async fn ensure_owner(db: &Db) -> Result<Id, AppError> {
    let mut tx = db.begin().await?;
    let owners: Vec<User> = tx.fetch_all(&user_select()).await?;
    let owner = match owners.as_slice() {
        [] => {
            tx.insert(
                USER,
                &ExecutionContext::new(Actor::System, "system-start"),
                [
                    ("display_name", "".into()),
                    ("password_hash", Value::String(None)),
                ],
            )
            .await?
        }
        [owner] => owner.id,
        _ => return Err(AppError::new(OWNER_INVALID)),
    };
    tx.commit().await?;
    Ok(owner)
}

pub fn validate_display_name(name: &str) -> Result<(), AppError> {
    if name.chars().count() > 128 || name.trim() != name || name.chars().any(char::is_control) {
        return Err(AppError::new(DISPLAY_NAME_INVALID));
    }
    Ok(())
}

pub(super) async fn locked_user(tx: &mut Tx<'_>, id: Id) -> Result<User, AppError> {
    tx.fetch_optional(
        &user_select()
            .and_where(Expr::col("id").eq(id))
            .lock_exclusive()
            .to_owned(),
    )
    .await?
    .ok_or_else(|| AppError::new(DATA_NOT_FOUND))
}

impl AccountService {
    /// 在调用者事务内锁住唯一所有者，用于串行化业务创建与导入。
    pub async fn lock_owner_in_tx(&self, tx: &mut Tx<'_>) -> Result<(), AppError> {
        locked_user(tx, self.owner_id()?).await?;
        Ok(())
    }

    pub async fn user_profile_update(
        &self,
        context: &ExecutionContext,
        input: UserProfileUpdate,
    ) -> Result<(), AppError> {
        self.started()?;
        validate_display_name(&input.display_name)?;
        let Actor::User(id) = context.actor else {
            return Err(AppError::new(INTERNAL_UNEXPECTED));
        };
        let mut tx = self.started()?.db.begin().await?;
        let user = locked_user(&mut tx, id).await?;
        tx.update_by_id(
            USER,
            context,
            id,
            Some(user.row_version),
            [("display_name", input.display_name.into())],
        )
        .await?;
        tx.commit().await
    }
}
impl PermissionChecker for AccountService {
    fn check(&self, actor: &ActiveActor, key: &str) -> Result<(), AppError> {
        self.started()?;
        if actor.permissions.iter().any(|permission| permission == key) {
            Ok(())
        } else {
            Err(AppError::new(tenon_framework::error::PERMISSION_DENIED)
                .with_param("permission", key))
        }
    }
}

impl tenon_framework::job::PermissionLookup for AccountService {
    fn has_permission<'a>(
        &'a self,
        actor: Actor,
        key: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<bool, AppError>> + Send + 'a>>
    {
        Box::pin(async move {
            let started = self.started()?;
            let Actor::User(id) = actor else {
                return Ok(true);
            };
            Ok(id == started.owner && started.permissions.contains(&key))
        })
    }
}

#[cfg(test)]
mod db;
