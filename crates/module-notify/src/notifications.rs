use std::sync::Arc;

use sea_query::{Expr, ExprTrait, Order, Query, SelectStatement};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::{Page, PageRequest, Tx},
    error::{AppError, INPUT_INVALID, INTERNAL_UNEXPECTED},
    id::Id,
    job::{
        AfterJobCommit, JobCompletionFuture, JobCompletionHook, JobQueue, JobSnapshot, JobStatus,
    },
    time::Timestamp,
};
use ts_rs::TS;

use crate::{DesktopDelivery, NotifyService};

tenon_framework::dict_enum! {
    pub enum BuiltinNotificationChannel {
        InApp => "in_app" (Neutral),
        Desktop => "desktop" (Neutral),
    }
}
tenon_framework::dict_enum! {
    pub enum DeliveryStatus {
        Delivered => "delivered" (Success),
        Failed => "failed" (Danger),
        Unknown => "unknown" (Warning),
        Skipped => "skipped" (Neutral),
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: Id,
    pub category: String,
    pub title_key: String,
    pub body_key: String,
    #[ts(type = "Record<string, string | number | { $t: string }>")]
    pub params: Map<String, Value>,
    pub job_id: Option<Id>,
    pub read_at: Option<Timestamp>,
    pub created_at: Timestamp,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListInput {
    #[serde(flatten)]
    pub pagination: PageRequest,
    pub unread_only: bool,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct NotificationReadInput {
    pub ids: Vec<Id>,
}

#[derive(Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum NotifyTestDesktop {
    Sent,
    Disabled,
    Failed,
}

#[derive(Debug, Serialize, TS)]
pub struct NotifyTestResult {
    pub desktop: NotifyTestDesktop,
}

#[derive(sqlx::FromRow)]
struct NotificationRecord {
    id: Id,
    category: String,
    title_key: String,
    body_key: String,
    params: String,
    job_id: Option<Id>,
    read_at: Option<Timestamp>,
    created_at: Timestamp,
}

impl NotificationRecord {
    fn item(self) -> Result<NotificationItem, AppError> {
        Ok(NotificationItem {
            id: self.id,
            category: self.category,
            title_key: self.title_key,
            body_key: self.body_key,
            params: serde_json::from_str(&self.params)
                .map_err(|error| AppError::new(INTERNAL_UNEXPECTED).with_source(error))?,
            job_id: self.job_id,
            read_at: self.read_at,
            created_at: self.created_at,
        })
    }
}

fn user_id(context: &ExecutionContext) -> Result<Id, AppError> {
    match context.actor {
        Actor::User(id) => Ok(id),
        Actor::System => Err(AppError::new(INTERNAL_UNEXPECTED)),
    }
}

fn query(user: Id) -> SelectStatement {
    Query::select()
        .column(sea_query::Asterisk)
        .from("notify_notification")
        .and_where(Expr::col("user_id").eq(user))
        .to_owned()
}

impl NotifyService {
    pub async fn notification_test_send(
        &self,
        context: &ExecutionContext,
    ) -> Result<NotifyTestResult, AppError> {
        let user = user_id(context)?;
        let started = self.started()?;
        let now = (self.clock)();
        let item = NotificationItem {
            id: Id::new(),
            category: "test".into(),
            title_key: "notify.test.title".into(),
            body_key: "notify.test.body".into(),
            params: Map::new(),
            job_id: None,
            read_at: None,
            created_at: now,
        };
        let mut tx = started.db.begin().await?;
        self.write_notification(&mut tx, user, &item).await?;
        let delivery = Id::new();
        write_delivery(
            &mut tx,
            delivery,
            item.id,
            "desktop",
            DeliveryStatus::Unknown,
            now,
        )
        .await?;
        tx.commit().await?;
        let outcome = self
            .account
            .with_active_user(user, || {
                if self
                    .desktop_gate
                    .with_enabled(&mut || Ok(DesktopDelivery::Delivered))?
                    == DesktopDelivery::Skipped
                {
                    return Ok(DesktopDelivery::Skipped);
                }
                // Translator 可读取同一配置锁；必须在进入 gate 前完成。
                let title = started.translator.text(&item.title_key, &item.params)?;
                let body = started.translator.text(&item.body_key, &item.params)?;
                self.desktop_gate.with_enabled(&mut || {
                    Ok(match self.notifier.send(&title, &body) {
                        Ok(()) => DesktopDelivery::Delivered,
                        Err(_) => DesktopDelivery::Failed(None),
                    })
                })
            })
            .await?
            .ok_or_else(|| AppError::new(tenon_module_account::AUTH_REQUIRED))?;
        let desktop = match &outcome {
            DesktopDelivery::Delivered => NotifyTestDesktop::Sent,
            DesktopDelivery::Skipped => NotifyTestDesktop::Disabled,
            DesktopDelivery::Failed(_) | DesktopDelivery::Unknown(_) => NotifyTestDesktop::Failed,
        };
        let mut tx = started.db.begin().await?;
        self.finish_delivery_in_tx(&mut tx, delivery, "desktop", outcome, (self.clock)())
            .await?;
        tx.commit().await?;
        Ok(NotifyTestResult { desktop })
    }

    async fn write_notification(
        &self,
        tx: &mut Tx<'_>,
        user: Id,
        item: &NotificationItem,
    ) -> Result<(), AppError> {
        let days = self
            .started()?
            .params
            .int_in(tx, "notify.retention_days")
            .await?;
        if days > 0 {
            let expired = query(user)
                .clear_selects()
                .column("id")
                .and_where(Expr::col("read_at").is_not_null())
                .and_where(Expr::col("read_at").lt(item.created_at.as_millis() - days * 86_400_000))
                .to_owned();
            // 投递表没有级联外键；两表在通知写入事务中一起清理。
            tx.execute(
                &Query::delete()
                    .from_table("notify_notification_delivery")
                    .and_where(Expr::col("notification_id").in_subquery(expired.clone()))
                    .to_owned(),
            )
            .await?;
            tx.execute(
                &Query::delete()
                    .from_table("notify_notification")
                    .and_where(Expr::col("user_id").eq(user))
                    .and_where(Expr::col("read_at").is_not_null())
                    .and_where(
                        Expr::col("read_at").lt(item.created_at.as_millis() - days * 86_400_000),
                    )
                    .to_owned(),
            )
            .await?;
        }
        tx.execute(
            &Query::insert()
                .into_table("notify_notification")
                .columns([
                    "id",
                    "user_id",
                    "category",
                    "title_key",
                    "body_key",
                    "params",
                    "job_id",
                    "read_at",
                    "created_at",
                ])
                .values_panic([
                    item.id.into(),
                    user.into(),
                    item.category.clone().into(),
                    item.title_key.clone().into(),
                    item.body_key.clone().into(),
                    Value::Object(item.params.clone()).to_string().into(),
                    item.job_id.map(|id| id.to_string()).into(),
                    sea_query::Value::BigInt(None).into(),
                    item.created_at.into(),
                ])
                .to_owned(),
        )
        .await?;
        write_delivery(
            tx,
            Id::new(),
            item.id,
            "in_app",
            DeliveryStatus::Delivered,
            item.created_at,
        )
        .await
    }

    pub async fn notification_list(
        &self,
        context: &ExecutionContext,
        input: NotificationListInput,
    ) -> Result<Page<NotificationItem>, AppError> {
        let mut query = query(user_id(context)?);
        if input.unread_only {
            query.and_where(Expr::col("read_at").is_null());
        }
        let page = self
            .started()?
            .db
            .fetch_page::<NotificationRecord>(
                &query,
                input.pagination,
                &[("created_at", Order::Desc), ("id", Order::Desc)],
            )
            .await?;
        Ok(Page {
            items: page
                .items
                .into_iter()
                .map(NotificationRecord::item)
                .collect::<Result<_, _>>()?,
            total: page.total,
            page: page.page,
            page_size: page.page_size,
        })
    }

    pub async fn notification_unread_count(
        &self,
        context: &ExecutionContext,
    ) -> Result<u32, AppError> {
        let (count,): (i64,) = self
            .started()?
            .db
            .fetch_optional(
                &query(user_id(context)?)
                    .clear_selects()
                    .expr(Expr::col("id").count())
                    .and_where(Expr::col("read_at").is_null())
                    .to_owned(),
            )
            .await?
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        count
            .try_into()
            .map_err(|error| AppError::new(INTERNAL_UNEXPECTED).with_source(error))
    }

    pub async fn notification_mark_read(
        &self,
        context: &ExecutionContext,
        input: NotificationReadInput,
    ) -> Result<(), AppError> {
        if input.ids.is_empty() || input.ids.len() > 100 {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "ids"));
        }
        self.mark_notifications(context, Some(input.ids)).await
    }

    pub async fn notification_mark_all_read(
        &self,
        context: &ExecutionContext,
    ) -> Result<(), AppError> {
        self.mark_notifications(context, None).await
    }

    async fn mark_notifications(
        &self,
        context: &ExecutionContext,
        ids: Option<Vec<Id>>,
    ) -> Result<(), AppError> {
        let mut statement = Query::update()
            .table("notify_notification")
            .value("read_at", (self.clock)())
            .and_where(Expr::col("user_id").eq(user_id(context)?))
            .and_where(Expr::col("read_at").is_null())
            .to_owned();
        if let Some(ids) = ids {
            statement.and_where(Expr::col("id").is_in(ids));
        }
        self.started()?.db.execute(&statement).await?;
        Ok(())
    }

    async fn finish_delivery_in_tx(
        &self,
        tx: &mut Tx<'_>,
        delivery_id: Id,
        channel: &str,
        outcome: DesktopDelivery,
        attempted_at: Timestamp,
    ) -> Result<(), AppError> {
        let updated = tx
            .execute(&delivery_update(
                delivery_id,
                channel,
                outcome,
                attempted_at,
            ))
            .await?;
        if updated != 1 {
            return Err(AppError::new(INTERNAL_UNEXPECTED));
        }
        Ok(())
    }
}

fn delivery_update(
    delivery_id: Id,
    channel: &str,
    outcome: DesktopDelivery,
    attempted_at: Timestamp,
) -> sea_query::UpdateStatement {
    let (status, error) = match outcome {
        DesktopDelivery::Delivered => (DeliveryStatus::Delivered, None),
        DesktopDelivery::Failed(error) => (DeliveryStatus::Failed, error),
        DesktopDelivery::Unknown(error) => (DeliveryStatus::Unknown, error),
        DesktopDelivery::Skipped => (DeliveryStatus::Skipped, None),
    };
    Query::update()
        .table("notify_notification_delivery")
        .value("status", status.as_str())
        .value("error_code", error)
        .value("attempted_at", attempted_at)
        .and_where(Expr::col("id").eq(delivery_id))
        .and_where(Expr::col("channel").eq(channel))
        .and_where(Expr::col("status").eq(DeliveryStatus::Unknown.as_str()))
        .to_owned()
}

async fn write_delivery(
    tx: &mut Tx<'_>,
    id: Id,
    notification: Id,
    channel: &str,
    status: DeliveryStatus,
    now: Timestamp,
) -> Result<(), AppError> {
    tx.execute(
        &Query::insert()
            .into_table("notify_notification_delivery")
            .columns([
                "id",
                "notification_id",
                "channel",
                "status",
                "error_code",
                "attempted_at",
            ])
            .values_panic([
                id.into(),
                notification.into(),
                channel.into(),
                status.as_str().into(),
                sea_query::Value::String(None).into(),
                now.into(),
            ])
            .to_owned(),
    )
    .await?;
    Ok(())
}

pub(super) struct NotificationHook(pub Arc<NotifyService>);

impl JobCompletionHook for NotificationHook {
    fn complete<'a>(
        &'a self,
        tx: &'a mut Tx<'_>,
        queue: &'a JobQueue,
        job: &'a JobSnapshot,
    ) -> JobCompletionFuture<'a> {
        Box::pin(async move {
            let Some(user) = job.submitted_by else {
                return Ok(None);
            };
            let preference = match job.status {
                JobStatus::Succeeded => "notify.job_succeeded",
                JobStatus::Failed => "notify.job_failed",
                JobStatus::NeedsReview => "notify.job_needs_review",
                _ => return Ok(None),
            };
            if !self.0.started()?.params.bool_in(tx, preference).await? {
                return Ok(None);
            }
            let mut params: Map<String, Value> = job
                .error_params
                .iter()
                .map(|(key, value)| (key.clone(), Value::String(value.clone())))
                .collect();
            params.insert(
                "kind".into(),
                json!({"$t": format!("jobs.kinds.{}", job.kind)}),
            );
            if job.status == JobStatus::Failed {
                let code = job
                    .error_code
                    .as_ref()
                    .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
                params.insert("error".into(), json!({"$t":format!("errors.{code}")}));
            }
            let now = (self.0.clock)();
            let item = NotificationItem {
                id: Id::new(),
                category: "job".into(),
                title_key: format!("notify.job.{}.title", job.status.as_str()),
                body_key: format!("notify.job.{}.body", job.status.as_str()),
                params,
                job_id: Some(job.id),
                read_at: None,
                created_at: now,
            };
            self.0.write_notification(tx, user, &item).await?;
            let delivery = Id::new();
            write_delivery(
                tx,
                delivery,
                item.id,
                "desktop",
                DeliveryStatus::Unknown,
                now,
            )
            .await?;
            let service = self.0.clone();
            let queue = queue.clone();
            Ok(Some(Box::pin(async move {
                queue.wake();
                let outcome = match service.send_desktop(user, &item).await {
                    Ok(outcome) => outcome,
                    Err(error) => DesktopDelivery::Unknown(Some(error.code().as_str().into())),
                };
                // 外部副作用不能回滚；结果写入失败保留 unknown，不重新投递。
                let saved = async {
                    let updated = service
                        .started()?
                        .db
                        .execute(&delivery_update(
                            delivery,
                            "desktop",
                            outcome,
                            (service.clock)(),
                        ))
                        .await?;
                    if updated != 1 {
                        return Err(AppError::new(INTERNAL_UNEXPECTED));
                    }
                    Ok(())
                }
                .await;
                if let Err(error) = &saved {
                    tracing::warn!(
                        channel = "desktop",
                        error_code = error.code().as_str(),
                        "Notification delivery result was not saved"
                    );
                }
                saved
            }) as AfterJobCommit))
        })
    }
}

#[cfg(test)]
mod db;
