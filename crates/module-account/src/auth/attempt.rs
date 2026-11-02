use std::{error::Error, future::Future};

use sea_query::{Expr, ExprTrait, Query, Value};
use tenon_framework::{
    db::{Db, Table, Tx, select},
    error::{AppError, INTERNAL_UNEXPECTED},
    id::Id,
};

use crate::{
    AccountService, AuthPolicy, CAPTCHA_INVALID, CAPTCHA_REQUIRED, CaptchaAnswer,
    INVALID_CREDENTIALS, TEMPORARILY_LOCKED, captcha,
};

const ATTEMPT: Table = Table {
    name: "account_login_attempt",
    audit: false,
    soft_delete: false,
    optimistic_lock: false,
};

#[derive(sqlx::FromRow)]
struct Attempt {
    failed_count: i32,
    last_failed_at: i64,
    locked_until: Option<i64>,
}

impl Attempt {
    fn count(&self, now: i64, config: AuthPolicy) -> i32 {
        if now - self.last_failed_at < config.lock_minutes * 60_000 {
            self.failed_count
        } else {
            0
        }
    }

    fn check_lock(&self, now: i64) -> Result<(), AppError> {
        if let Some(until) = self.locked_until
            && until > now
        {
            return Err(locked(until - now));
        }
        Ok(())
    }
}

fn locked(remaining_ms: i64) -> AppError {
    AppError::new(TEMPORARILY_LOCKED)
        .with_param("minutes", ((remaining_ms + 59_999) / 60_000).to_string())
}

async fn read_attempt(db: &Db, user_id: Id) -> Result<(Tx<'static>, Attempt), AppError> {
    let mut query = select(ATTEMPT).into_query();
    query
        .and_where(Expr::col("user_id").eq(user_id))
        .lock_exclusive();
    let mut tx = db.begin().await?;
    if let Some(attempt) = tx.fetch_optional(&query).await? {
        return Ok((tx, attempt));
    }
    let mut insert = Query::insert();
    insert
        .into_table(ATTEMPT.name)
        .columns(["user_id", "failed_count", "last_failed_at", "locked_until"])
        .values_panic([
            user_id.into(),
            0_i32.into(),
            0_i64.into(),
            Value::BigInt(None).into(),
        ]);
    if let Err(error) = tx.execute(&insert).await {
        let unique = error
            .source()
            .and_then(|source| source.downcast_ref::<sqlx::Error>())
            .and_then(sqlx::Error::as_database_error)
            .is_some_and(|error| error.is_unique_violation());
        if !unique {
            return Err(error);
        }
        // PostgreSQL 的失败事务不可继续，MySQL 也需要新的读视图；只针对唯一冲突重读一次。
        tx.rollback().await?;
        let mut tx = db.begin().await?;
        let attempt = tx
            .fetch_optional(&query)
            .await?
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        return Ok((tx, attempt));
    }
    Ok((
        tx,
        Attempt {
            failed_count: 0,
            last_failed_at: 0,
            locked_until: None,
        },
    ))
}

impl AccountService {
    pub(super) async fn attempt<T>(
        &self,
        captcha: Option<CaptchaAnswer>,
        verify: impl Future<Output = Result<T, AppError>>,
    ) -> Result<T, AppError> {
        let user_id = self.started()?.owner;
        let config = self.settings.read()?;
        let db = &self.started()?.db;
        // 与模式切换事务相同：隔离多驱动事务 future，避免宿主 release 的布局查询超限。
        let (tx, attempt) = Box::pin(read_attempt(db, user_id)).await?;
        let now = (self.clock)().as_millis();
        let allowed = attempt.check_lock(now);
        let needs_captcha = i64::from(attempt.count(now, config)) >= config.captcha_after_failures;
        tx.commit().await?;
        allowed?;
        if needs_captcha {
            let answer = captcha.ok_or_else(|| AppError::new(CAPTCHA_REQUIRED))?;
            if !captcha::verify(&self.started()?.cache, answer).await? {
                return Err(AppError::new(CAPTCHA_INVALID));
            }
        }
        // 凭据哈希及用例本身在保护事务之外执行。存储故障不计为凭据失败。
        let result = verify.await;
        if result
            .as_ref()
            .is_err_and(|error| error.code() != INVALID_CREDENTIALS)
        {
            return result;
        }
        let (mut tx, attempt) = Box::pin(read_attempt(db, user_id)).await?;
        let now = (self.clock)().as_millis();
        let mut update = Query::update();
        update
            .table(ATTEMPT.name)
            .and_where(Expr::col("user_id").eq(user_id));
        let mut failure = None;
        if result.is_ok() {
            update.values([
                ("failed_count", 0_i32.into()),
                ("last_failed_at", 0_i64.into()),
                ("locked_until", Value::BigInt(None).into()),
            ]);
        } else {
            attempt.check_lock(now)?;
            // 哈希期间其他实例可能已增加计数，锁定重读后的当前值才是更新基准。
            let count = attempt.count(now, config) + 1;
            let until = if i64::from(count) >= config.lock_after_failures {
                failure = Some(locked(config.lock_minutes * 60_000));
                Some(now + config.lock_minutes * 60_000)
            } else {
                None
            };
            update.values([
                ("failed_count", count.into()),
                ("last_failed_at", now.into()),
                ("locked_until", Value::BigInt(until).into()),
            ]);
        }
        tx.execute(&update).await?;
        tx.commit().await?;
        match failure {
            Some(error) => Err(error),
            None => result,
        }
    }
}
