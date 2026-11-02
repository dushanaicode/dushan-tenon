use croner::{
    Cron,
    parser::{CronParser, Seconds, Year},
};
use jiff::{Zoned, tz::TimeZone};
use sea_query::{Expr, ExprTrait, OnConflict, Order, Query, SelectStatement, UpdateStatement};
use serde::Serialize;
use ts_rs::TS;

use super::{INVALID_STATE, JobQueue, JobStatus, SubmitJob};
use crate::{
    error::{AppError, DATA_NOT_FOUND, INTERNAL_UNEXPECTED, MODULE_DISABLED},
    id::Id,
    time::Timestamp,
};

#[derive(Clone, Copy, Debug)]
pub struct ScheduleDeclaration {
    pub key: &'static str,
    pub kind: &'static str,
    pub cron: &'static str,
    pub enabled: bool,
    pub payload: &'static str,
}

#[derive(Debug, thiserror::Error)]
pub enum ScheduleError {
    #[error("schedule is no longer declared")]
    Undeclared,
    #[error(transparent)]
    App(#[from] AppError),
}

#[derive(Debug, thiserror::Error)]
enum TimingError {
    #[error("invalid five-field cron")]
    CronInvalid,
    #[error("invalid IANA timezone")]
    TimezoneInvalid,
}

impl TimingError {
    fn internal(self) -> AppError {
        AppError::new(INTERNAL_UNEXPECTED).with_source(self)
    }
}

struct Timing {
    cron: Cron,
    timezone: TimeZone,
}

impl Timing {
    fn new(cron: &str, timezone: &str) -> Result<Self, TimingError> {
        if cron.len() > 128 || cron.split_whitespace().count() != 5 {
            return Err(TimingError::CronInvalid);
        }
        let cron = CronParser::builder()
            .seconds(Seconds::Disallowed)
            .year(Year::Disallowed)
            .build()
            .parse(cron)
            .map_err(|_| TimingError::CronInvalid)?;
        if timezone.len() > 64 {
            return Err(TimingError::TimezoneInvalid);
        }
        let timezone = TimeZone::get(timezone).map_err(|_| TimingError::TimezoneInvalid)?;
        if timezone.iana_name().is_none() {
            return Err(TimingError::TimezoneInvalid);
        }
        Ok(Self { cron, timezone })
    }

    fn next(&self, after: Timestamp) -> Result<Zoned, TimingError> {
        let after = jiff::Timestamp::from_millisecond(after.as_millis())
            .map_err(|_| TimingError::CronInvalid)?
            .to_zoned(self.timezone.clone());
        self.cron
            .find_next_occurrence(&after, false)
            .map_err(|_| TimingError::CronInvalid)
    }
}

fn timestamp(zoned: &Zoned) -> Result<Timestamp, AppError> {
    Timestamp::from_millis(zoned.timestamp().as_millisecond())
        .map_err(|error| AppError::new(INTERNAL_UNEXPECTED).with_source(error))
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSnapshot {
    pub id: Id,
    pub key: String,
    pub kind: String,
    pub cron: String,
    pub timezone: String,
    pub enabled: bool,
    pub declared: bool,
    pub next_run_at: Option<Timestamp>,
    pub last_run_at: Option<Timestamp>,
    pub last_job_id: Option<Id>,
    pub last_job_status: Option<JobStatus>,
}

#[derive(sqlx::FromRow)]
struct Record {
    id: Id,
    key: String,
    kind: String,
    payload: String,
    cron: String,
    timezone: String,
    enabled: bool,
    next_run_at: Option<Timestamp>,
    last_run_at: Option<Timestamp>,
    last_job_id: Option<Id>,
    last_job_status: Option<String>,
    row_version: i64,
}

fn query() -> SelectStatement {
    Query::select()
        .column(("fw_job_schedule", sea_query::Asterisk))
        .expr_as(Expr::col(("fw_job", "status")), "last_job_status")
        .from("fw_job_schedule")
        .left_join(
            "fw_job",
            Expr::col(("fw_job", "id")).equals(("fw_job_schedule", "last_job_id")),
        )
        .to_owned()
}

fn update(id: Id, now: Timestamp) -> UpdateStatement {
    Query::update()
        .table("fw_job_schedule")
        .and_where(Expr::col("id").eq(id))
        .value("row_version", Expr::col("row_version").add(1_i64))
        .value("updated_at", now)
        .to_owned()
}

impl JobQueue {
    pub async fn sync_schedules(&self, now: Timestamp) -> Result<(), AppError> {
        let zone = TimeZone::system();
        let timezone = zone.iana_name().unwrap_or_else(|| {
            tracing::warn!("本机时区没有 IANA 名称，任务计划同步使用 UTC");
            "UTC"
        });
        for registered in self.0.schedules.values() {
            let declaration = &registered.declaration;
            let timing = Timing::new(declaration.cron, timezone).map_err(TimingError::internal)?;
            let payload: serde_json::Value = serde_json::from_str(declaration.payload)
                .map_err(|error| AppError::new(INTERNAL_UNEXPECTED).with_source(error))?;
            let payload = payload.to_string();
            loop {
                let existing: Option<Record> = self
                    .0
                    .db
                    .fetch_optional(
                        &query()
                            .and_where(Expr::col(("fw_job_schedule", "key")).eq(declaration.key))
                            .to_owned(),
                    )
                    .await?;
                if let Some(row) = existing {
                    let timing_changed = row.cron != declaration.cron
                        || row.timezone != timezone
                        || row.enabled != declaration.enabled;
                    let next_run_at =
                        if timing_changed || (declaration.enabled && row.next_run_at.is_none()) {
                            if declaration.enabled {
                                Some(timestamp(
                                    &timing.next(now).map_err(TimingError::internal)?,
                                )?)
                            } else {
                                None
                            }
                        } else {
                            row.next_run_at
                        };
                    if !timing_changed
                        && row.kind == declaration.kind
                        && row.payload == payload
                        && row.next_run_at == next_run_at
                    {
                        break;
                    }
                    // 与到期触发竞争时重新读取，避免覆盖刚推进的下次时间。
                    let changed = self
                        .0
                        .db
                        .execute(
                            &update(row.id, now)
                                .and_where(Expr::col("row_version").eq(row.row_version))
                                .value("kind", declaration.kind)
                                .value("payload", payload.clone())
                                .value("cron", declaration.cron)
                                .value("timezone", timezone)
                                .value("enabled", declaration.enabled)
                                .value("next_run_at", next_run_at.map(|time| time.as_millis()))
                                .to_owned(),
                        )
                        .await?;
                    if changed == 1 {
                        break;
                    }
                    continue;
                }
                let next = timestamp(&timing.next(now).map_err(TimingError::internal)?)?;
                self.0
                    .db
                    .execute(
                        &Query::insert()
                            .into_table("fw_job_schedule")
                            .columns([
                                "id",
                                "key",
                                "kind",
                                "payload",
                                "cron",
                                "timezone",
                                "enabled",
                                "next_run_at",
                                "created_at",
                                "updated_at",
                                "row_version",
                            ])
                            .values_panic([
                                Id::new().into(),
                                declaration.key.into(),
                                declaration.kind.into(),
                                payload.clone().into(),
                                declaration.cron.into(),
                                timezone.into(),
                                declaration.enabled.into(),
                                declaration.enabled.then_some(next.as_millis()).into(),
                                now.into(),
                                now.into(),
                                1_i64.into(),
                            ])
                            .on_conflict(
                                OnConflict::column("key").do_nothing_on(["key"]).to_owned(),
                            )
                            .to_owned(),
                    )
                    .await?;
                // 首次并发启动由唯一键仲裁，再读取以应用当前声明。
            }
        }
        Ok(())
    }

    pub async fn list_schedules(&self) -> Result<Vec<ScheduleSnapshot>, AppError> {
        self.0
            .db
            .fetch_all::<Record>(
                &query()
                    .order_by(("fw_job_schedule", "key"), Order::Asc)
                    .to_owned(),
            )
            .await?
            .into_iter()
            .map(|row| {
                let declared = self.0.schedules.contains_key(row.key.as_str());
                if declared {
                    self.validate_schedule(&row)?;
                }
                let last_job_status = row
                    .last_job_status
                    .map(JobStatus::try_from)
                    .transpose()
                    .map_err(|_| AppError::new(INVALID_STATE))?;
                Ok(ScheduleSnapshot {
                    id: row.id,
                    key: row.key,
                    kind: row.kind,
                    cron: row.cron,
                    timezone: row.timezone,
                    enabled: row.enabled,
                    declared,
                    next_run_at: row.next_run_at,
                    last_run_at: row.last_run_at,
                    last_job_id: row.last_job_id,
                    last_job_status,
                })
            })
            .collect()
    }

    async fn declared_schedule(&self, id: Id) -> Result<Record, ScheduleError> {
        let row: Record = self
            .0
            .db
            .fetch_optional(
                &query()
                    .and_where(Expr::col(("fw_job_schedule", "id")).eq(id))
                    .to_owned(),
            )
            .await?
            .ok_or_else(|| AppError::new(DATA_NOT_FOUND))?;
        if !self.0.schedules.contains_key(row.key.as_str()) {
            return Err(ScheduleError::Undeclared);
        }
        Ok(row)
    }

    fn validate_schedule(&self, row: &Record) -> Result<&super::RegisteredSchedule, AppError> {
        let declaration = self
            .0
            .schedules
            .get(row.key.as_str())
            .ok_or_else(|| AppError::new(INVALID_STATE))?;
        if row.kind != declaration.declaration.kind {
            return Err(AppError::new(INVALID_STATE));
        }
        Ok(declaration)
    }

    pub async fn run_schedule_now(
        &self,
        id: Id,
        submitted_by: Option<Id>,
    ) -> Result<Id, ScheduleError> {
        let row = self.declared_schedule(id).await?;
        let declaration = self.validate_schedule(&row)?;
        if !self.0.handlers.contains_key(row.kind.as_str()) {
            return Err(AppError::new(MODULE_DISABLED)
                .with_param("module", declaration.module)
                .into());
        }
        let payload = serde_json::from_str(&row.payload)
            .map_err(|error| AppError::new(INVALID_STATE).with_source(error))?;
        Ok(self
            .submit(
                &self.0.db,
                SubmitJob {
                    kind: row.kind,
                    payload,
                    priority: 0,
                    run_after: None,
                    submitted_by,
                },
            )
            .await?)
    }

    pub(super) async fn trigger_schedules(&self, now: Timestamp) -> Result<(), AppError> {
        let due: Vec<Record> = self
            .0
            .db
            .fetch_all(
                &query()
                    .and_where(Expr::col(("fw_job_schedule", "enabled")).eq(true))
                    .and_where(Expr::col(("fw_job_schedule", "next_run_at")).lte(now))
                    .to_owned(),
            )
            .await?;
        for record in due {
            let DueSchedule { row, next_run_at } = DueSchedule::try_from(record)?;
            if !self.0.schedules.contains_key(row.key.as_str()) {
                continue;
            }
            self.validate_schedule(&row)?;
            if !self.0.handlers.contains_key(row.kind.as_str()) {
                continue;
            }
            let next = Timing::new(&row.cron, &row.timezone)
                .and_then(|timing| timing.next(now))
                .map_err(|_| AppError::new(INVALID_STATE))?;
            let next = timestamp(&next)?;
            let payload = serde_json::from_str(&row.payload)
                .map_err(|error| AppError::new(INVALID_STATE).with_source(error))?;
            let mut tx = self.0.db.begin().await?;
            let changed = tx
                .execute(
                    &update(row.id, now)
                        .and_where(Expr::col("next_run_at").eq(next_run_at))
                        .and_where(Expr::col("enabled").eq(true))
                        .and_where(Expr::col("row_version").eq(row.row_version))
                        .value("next_run_at", next)
                        .value("last_run_at", now)
                        .to_owned(),
                )
                .await?;
            if changed == 0 {
                tx.rollback().await?;
                continue;
            }
            let job_id = self
                .submit(
                    &mut tx,
                    SubmitJob {
                        kind: row.kind,
                        payload,
                        priority: 0,
                        run_after: None,
                        submitted_by: None,
                    },
                )
                .await?;
            tx.execute(
                &Query::update()
                    .table("fw_job_schedule")
                    .and_where(Expr::col("id").eq(row.id))
                    .value("last_job_id", job_id)
                    .to_owned(),
            )
            .await?;
            tx.commit().await?;
        }
        Ok(())
    }
}

struct DueSchedule {
    row: Record,
    next_run_at: Timestamp,
}

impl TryFrom<Record> for DueSchedule {
    type Error = AppError;
    fn try_from(row: Record) -> Result<Self, AppError> {
        let next_run_at = row
            .next_run_at
            .ok_or_else(|| AppError::new(INVALID_STATE))?;
        Ok(Self { row, next_run_at })
    }
}

#[cfg(test)]
mod tests;
