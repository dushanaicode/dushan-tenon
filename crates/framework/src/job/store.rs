use std::collections::BTreeMap;

use sea_query::{Expr, ExprTrait, Order, Query, SelectStatement, UpdateStatement, Value};
use serde::de::DeserializeOwned;

use super::*;
use crate::{
    db::{Page, PageRequest, Tx},
    error::{DATA_NOT_FOUND, ErrorCode, MODULE_DISABLED},
    id::Id,
    time::Timestamp,
};

pub enum JobTarget<'a, 'tx> {
    Db(&'a Db),
    Tx(&'a mut Tx<'tx>),
}
impl<'a> From<&'a Db> for JobTarget<'a, 'static> {
    fn from(db: &'a Db) -> Self {
        Self::Db(db)
    }
}
impl<'a, 'tx> From<&'a mut Tx<'tx>> for JobTarget<'a, 'tx> {
    fn from(tx: &'a mut Tx<'tx>) -> Self {
        Self::Tx(tx)
    }
}

#[derive(sqlx::FromRow)]
pub(super) struct JobRecord {
    id: Id,
    kind: String,
    module: String,
    payload: String,
    priority: i32,
    status: String,
    lease_owner: Option<String>,
    attempts: i32,
    max_attempts: i32,
    retry_safe: bool,
    run_after: Timestamp,
    progress_current: Option<i64>,
    progress_total: Option<i64>,
    progress_message: Option<String>,
    progress_params: Option<String>,
    result: Option<String>,
    error_code: Option<String>,
    error_params: Option<String>,
    cancel_requested: bool,
    submitted_by: Option<Id>,
    created_at: Timestamp,
    updated_at: Timestamp,
    started_at: Option<Timestamp>,
    finished_at: Option<Timestamp>,
    row_version: i64,
}

fn json<T: DeserializeOwned>(text: &str) -> Result<T, AppError> {
    serde_json::from_str(text).map_err(|error| AppError::new(INVALID_STATE).with_source(error))
}

impl JobRecord {
    pub(super) fn snapshot(self) -> Result<JobSnapshot, AppError> {
        Ok(self.read()?.snapshot)
    }

    fn read(self) -> Result<StoredJob, AppError> {
        let status = JobStatus::try_from(self.status).map_err(|_| AppError::new(INVALID_STATE))?;
        if !valid_value(&self.module)
            || !valid_key(&self.kind, &self.module)
            || self.attempts < 0
            || self.max_attempts < 1
            || (status == JobStatus::Running
                && (self.attempts == 0
                    || self.started_at.is_none()
                    || self.lease_owner.as_deref().is_none_or(str::is_empty)))
        {
            return Err(AppError::new(INVALID_STATE));
        }
        let terminal = match status {
            JobStatus::Queued | JobStatus::Running => None,
            JobStatus::Succeeded => Some(TerminalJob::Succeeded),
            JobStatus::Cancelled => Some(TerminalJob::Cancelled),
            JobStatus::NeedsReview => Some(TerminalJob::NeedsReview),
            JobStatus::Failed => {
                let code = self
                    .error_code
                    .clone()
                    .filter(|code| crate::error::is_valid_code(code))
                    .ok_or_else(|| AppError::new(INVALID_STATE))?;
                Some(TerminalJob::Failed { code })
            }
        };
        let snapshot = JobSnapshot {
            id: self.id,
            kind: self.kind,
            module: self.module,
            payload: json(&self.payload)?,
            priority: self.priority,
            status,
            attempts: self.attempts,
            max_attempts: self.max_attempts,
            retry_safe: self.retry_safe,
            run_after: self.run_after,
            progress: JobProgress {
                current: self.progress_current,
                total: self.progress_total,
                message_key: self.progress_message,
                params: self
                    .progress_params
                    .as_deref()
                    .map(json)
                    .transpose()?
                    .unwrap_or_default(),
            },
            result: self.result.as_deref().map(json).transpose()?,
            error_code: self.error_code,
            error_params: self
                .error_params
                .as_deref()
                .map(json)
                .transpose()?
                .unwrap_or_default(),
            cancel_requested: self.cancel_requested,
            submitted_by: self.submitted_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
            started_at: self.started_at,
            finished_at: self.finished_at,
            row_version: self.row_version,
        };
        Ok(StoredJob { snapshot, terminal })
    }
}

pub(super) fn query() -> SelectStatement {
    Query::select()
        .columns([
            "id",
            "kind",
            "module",
            "payload",
            "priority",
            "status",
            "lease_owner",
            "attempts",
            "max_attempts",
            "retry_safe",
            "run_after",
            "progress_current",
            "progress_total",
            "progress_message",
            "progress_params",
            "result",
            "error_code",
            "error_params",
            "cancel_requested",
            "submitted_by",
            "created_at",
            "updated_at",
            "started_at",
            "finished_at",
            "row_version",
        ])
        .from("fw_job")
        .to_owned()
}

pub(super) fn update(id: Id) -> UpdateStatement {
    Query::update()
        .table("fw_job")
        .and_where(Expr::col("id").eq(id))
        .value("row_version", Expr::col("row_version").add(1_i64))
        .value("updated_at", Timestamp::now())
        .to_owned()
}

/// started_at 同时作为一次领取的栅栏，防止同一实例重新领取后旧执行覆盖新结果。
pub(super) fn leased(id: Id, owner: &str, started_at: Timestamp) -> UpdateStatement {
    update(id)
        .and_where(Expr::col("lease_owner").eq(owner))
        .and_where(Expr::col("status").eq("running"))
        .and_where(Expr::col("started_at").eq(started_at))
        .to_owned()
}

pub(super) fn clear_lease(update: &mut UpdateStatement) {
    update
        .value("lease_owner", Value::String(None))
        .value("lease_expires_at", Value::BigInt(None));
}

fn reset(update: &mut UpdateStatement) {
    clear_lease(update);
    for column in [
        "error_code",
        "error_params",
        "result",
        "progress_message",
        "progress_params",
    ] {
        update.value(column, Value::String(None));
    }
    for column in [
        "progress_current",
        "progress_total",
        "started_at",
        "finished_at",
    ] {
        update.value(column, Value::BigInt(None));
    }
    update
        .value("status", "queued")
        .value("attempts", 0)
        .value("cancel_requested", false)
        .value("run_after", Timestamp::now());
}

impl JobQueue {
    pub async fn submit<'a, 'tx: 'a>(
        &self,
        target: impl Into<JobTarget<'a, 'tx>>,
        input: SubmitJob,
    ) -> Result<Id, AppError> {
        let handler = self
            .0
            .handlers
            .get(input.kind.as_str())
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        let id = Id::new();
        let now = Timestamp::now();
        let statement = Query::insert()
            .into_table("fw_job")
            .columns([
                "id",
                "kind",
                "module",
                "payload",
                "priority",
                "status",
                "attempts",
                "max_attempts",
                "retry_safe",
                "run_after",
                "cancel_requested",
                "submitted_by",
                "instance_id",
                "created_at",
                "updated_at",
                "row_version",
            ])
            .values_panic([
                id.into(),
                input.kind.clone().into(),
                handler.module.into(),
                input.payload.to_string().into(),
                input.priority.into(),
                "queued".into(),
                0.into(),
                handler.handler.max_attempts().into(),
                handler.handler.retry_safe().into(),
                input.run_after.unwrap_or(now).into(),
                false.into(),
                input.submitted_by.map(|id| id.to_string()).into(),
                handler
                    .handler
                    .local_only()
                    .then(|| self.0.instance_id.to_string())
                    .into(),
                now.into(),
                now.into(),
                1_i64.into(),
            ])
            .to_owned();
        match target.into() {
            JobTarget::Db(db) => {
                db.execute(&statement).await?;
            }
            JobTarget::Tx(tx) => {
                tx.execute(&statement).await?;
            }
        }
        self.wake();
        Ok(id)
    }

    pub async fn get(&self, id: Id) -> Result<JobSnapshot, AppError> {
        Ok(self.read(id).await?.snapshot)
    }

    pub(super) async fn read(&self, id: Id) -> Result<StoredJob, AppError> {
        self.0
            .db
            .fetch_optional::<JobRecord>(&query().and_where(Expr::col("id").eq(id)).to_owned())
            .await?
            .ok_or_else(|| AppError::new(DATA_NOT_FOUND))?
            .read()
    }

    pub async fn list(
        &self,
        page: PageRequest,
        status: Option<JobStatus>,
        kind: Option<&str>,
    ) -> Result<Page<JobSnapshot>, AppError> {
        let mut query = query();
        if let Some(status) = status {
            query.and_where(Expr::col("status").eq(status.as_str()));
        }
        if let Some(kind) = kind {
            query.and_where(Expr::col("kind").eq(kind));
        }
        let page = self
            .0
            .db
            .fetch_page::<JobRecord>(
                &query,
                page,
                &[("created_at", Order::Desc), ("id", Order::Desc)],
            )
            .await?;
        Ok(Page {
            items: page
                .items
                .into_iter()
                .map(JobRecord::snapshot)
                .collect::<Result<_, _>>()?,
            total: page.total,
            page: page.page,
            page_size: page.page_size,
        })
    }

    pub async fn cancel(&self, id: Id) -> Result<bool, AppError> {
        self.require_handler(id).await?;
        // 本机正在持有业务写事务时，先通知处理器回滚再持久化取消请求。
        if let Some(cancellation) = self
            .0
            .running
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .get(&id)
        {
            cancellation.cancel();
        }
        let mut statement = update(id);
        statement
            .and_where(Expr::col("status").eq("queued"))
            .value("status", "cancelled")
            .value("cancel_requested", true)
            .value("finished_at", Timestamp::now());
        let mut tx = self.0.db.begin().await?;
        if tx.execute(&statement).await? == 1 {
            let callbacks = self.complete(&mut tx, id).await?;
            tx.commit().await?;
            self.after_commit(id, callbacks).await?;
            return Ok(true);
        }
        tx.rollback().await?;
        let changed = self
            .0
            .db
            .execute(
                &update(id)
                    .and_where(Expr::col("status").eq("running"))
                    .value("cancel_requested", true)
                    .to_owned(),
            )
            .await?
            == 1;
        if changed {
            self.publish(id).await?;
        }
        Ok(changed)
    }

    pub async fn retry(&self, id: Id) -> Result<bool, AppError> {
        self.require_handler(id).await?;
        let mut statement = update(id);
        statement.and_where(Expr::col("status").is_in(["failed", "cancelled", "needs_review"]));
        reset(&mut statement);
        let changed = self.0.db.execute(&statement).await? == 1;
        if changed {
            self.publish(id).await?;
            self.wake();
        }
        Ok(changed)
    }

    pub async fn resolve(
        &self,
        id: Id,
        succeeded: bool,
        code: ErrorCode,
    ) -> Result<bool, AppError> {
        self.require_handler(id).await?;
        let mut statement = update(id);
        clear_lease(&mut statement);
        statement
            .and_where(Expr::col("status").eq("needs_review"))
            .value("status", if succeeded { "succeeded" } else { "failed" })
            .value("error_code", code.as_str())
            .value("error_params", "{}")
            .value("finished_at", Timestamp::now());
        let changed = self.0.db.execute(&statement).await? == 1;
        if changed {
            self.publish(id).await?;
        }
        Ok(changed)
    }

    async fn require_handler(&self, id: Id) -> Result<(), AppError> {
        let job = self.get(id).await?;
        if !self.0.handlers.contains_key(job.kind.as_str()) {
            return Err(AppError::new(MODULE_DISABLED).with_param("module", job.module));
        }
        Ok(())
    }

    pub(super) async fn publish(&self, id: Id) -> Result<(), AppError> {
        self.broadcast(self.get(id).await?.event());
        Ok(())
    }

    pub(super) async fn candidates(&self, now: Timestamp) -> Result<Vec<JobSnapshot>, AppError> {
        self.0
            .db
            .fetch_all::<JobRecord>(
                &query()
                    .and_where(Expr::col("status").eq("queued"))
                    .and_where(Expr::col("run_after").lte(now))
                    .and_where(
                        Expr::col("instance_id")
                            .is_null()
                            .or(Expr::col("instance_id").eq(self.0.instance_id.to_string())),
                    )
                    .order_by("priority", Order::Desc)
                    .order_by("created_at", Order::Asc)
                    .order_by("id", Order::Asc)
                    .to_owned(),
            )
            .await?
            .into_iter()
            .map(JobRecord::snapshot)
            .collect()
    }

    pub(super) async fn claim(
        &self,
        id: Id,
        owner: &str,
        now: Timestamp,
        lease_seconds: u64,
    ) -> Result<Option<LeasedJob>, AppError> {
        let changed = self
            .0
            .db
            .execute(
                &update(id)
                    .and_where(Expr::col("status").eq("queued"))
                    .and_where(Expr::col("run_after").lte(now))
                    .and_where(
                        Expr::col("instance_id")
                            .is_null()
                            .or(Expr::col("instance_id").eq(self.0.instance_id.to_string())),
                    )
                    .value("status", "running")
                    .value("lease_owner", owner)
                    .value(
                        "lease_expires_at",
                        now.as_millis() + lease_seconds as i64 * 1000,
                    )
                    .value("attempts", Expr::col("attempts").add(1))
                    .value("started_at", now)
                    .to_owned(),
            )
            .await?;
        if changed == 0 {
            return Ok(None);
        }
        let record = self
            .0
            .db
            .fetch_optional::<JobRecord>(&query().and_where(Expr::col("id").eq(id)).to_owned())
            .await?
            .ok_or_else(|| AppError::new(INVALID_STATE))?;
        let started_at = record
            .started_at
            .ok_or_else(|| AppError::new(INVALID_STATE))?;
        let lease_owner = record
            .lease_owner
            .clone()
            .filter(|owner| !owner.is_empty())
            .ok_or_else(|| AppError::new(INVALID_STATE))?;
        let snapshot = record.snapshot()?;
        if snapshot.status != JobStatus::Running || lease_owner != owner || started_at != now {
            return Ok(None);
        }
        self.broadcast(snapshot.event());
        Ok(Some(LeasedJob {
            snapshot,
            started_at,
            owner: lease_owner,
        }))
    }

    pub async fn reconcile(&self, now: Timestamp) -> Result<(), AppError> {
        let expired: Vec<JobRecord> = self
            .0
            .db
            .fetch_all(
                &query()
                    .and_where(Expr::col("status").eq("running"))
                    .and_where(Expr::col("lease_expires_at").lt(now))
                    .to_owned(),
            )
            .await?;
        for record in expired {
            let job = record.snapshot()?;
            if !self.0.handlers.contains_key(job.kind.as_str()) {
                continue;
            }
            let mut statement = update(job.id);
            statement
                .and_where(Expr::col("status").eq("running"))
                .and_where(Expr::col("lease_expires_at").lt(now))
                .and_where(Expr::col("row_version").eq(job.row_version));
            clear_lease(&mut statement);
            if job.retry_safe && job.attempts < job.max_attempts {
                statement.value("status", "queued").value("run_after", now);
            } else {
                statement
                    .value("status", "needs_review")
                    .value("finished_at", now);
            }
            let mut tx = self.0.db.begin().await?;
            if tx.execute(&statement).await? == 1 {
                let callbacks = self.complete(&mut tx, job.id).await?;
                tx.commit().await?;
                self.after_commit(job.id, callbacks).await?;
            } else {
                tx.rollback().await?;
            }
        }
        Ok(())
    }
}

pub(super) fn error_params(error: &AppError) -> BTreeMap<String, String> {
    error
        .params
        .iter()
        .map(|(key, value)| ((*key).into(), value.clone()))
        .collect()
}
