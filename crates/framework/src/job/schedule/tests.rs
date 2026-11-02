use super::*;
use crate::{
    actor::Actor,
    db::{
        PageRequest,
        test_support::{self, TestDb},
    },
    job::JobsConfig,
    job::ScheduleDeclaration,
    job::{JobContext, JobFuture, JobHandler, JobRunner, PermissionLookup},
};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

const DECLARATION: ScheduleDeclaration = ScheduleDeclaration {
    key: "test.daily",
    kind: "test.job",
    cron: "0 3 * * *",
    enabled: true,
    payload: r#"{"source":"schedule"}"#,
};

struct Handler(Arc<AtomicUsize>);
impl JobHandler for Handler {
    fn kind(&self) -> &'static str {
        "test.job"
    }
    fn permissions(&self) -> &'static [&'static str] {
        &["test.job.run"]
    }
    fn retry_safe(&self) -> bool {
        true
    }
    fn max_attempts(&self) -> i32 {
        1
    }
    fn run(&self, context: JobContext) -> JobFuture<'_> {
        Box::pin(async move {
            assert_eq!(context.execution.actor, Actor::System);
            assert_eq!(context.payload["source"], "schedule");
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    }
}
struct Permission;
impl PermissionLookup for Permission {
    fn has_permission<'a>(
        &'a self,
        _: Actor,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AppError>> + Send + 'a>> {
        panic!("system schedules must not resolve a user permission")
    }
}
fn queue(test: &TestDb, count: Arc<AtomicUsize>) -> JobQueue {
    JobQueue::new(
        test.db.clone(),
        vec![Arc::new(Handler(count))],
        vec![DECLARATION],
        vec![],
        crate::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
    )
    .unwrap()
}
async fn first(queue: &JobQueue) -> ScheduleSnapshot {
    queue.list_schedules().await.unwrap().remove(0)
}
fn declared_queue(test: &TestDb, declaration: ScheduleDeclaration) -> JobQueue {
    JobQueue::new(
        test.db.clone(),
        vec![Arc::new(Handler(Default::default()))],
        vec![declaration],
        vec![],
        crate::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
    )
    .unwrap()
}
async fn stored(
    queue: &JobQueue,
) -> (
    i64,
    Timestamp,
    Option<Timestamp>,
    Option<Timestamp>,
    Option<Id>,
) {
    queue
        .0
        .db
        .fetch_optional(
            &Query::select()
                .columns([
                    "row_version",
                    "updated_at",
                    "next_run_at",
                    "last_run_at",
                    "last_job_id",
                ])
                .from("fw_job_schedule")
                .to_owned(),
        )
        .await
        .unwrap()
        .unwrap()
}
fn occurrences(cron: &str, timezone: &str, mut after: Timestamp) -> Vec<String> {
    let timing = Timing::new(cron, timezone).unwrap();
    (0..3)
        .map(|_| {
            let next = timing.next(after).unwrap();
            after = timestamp(&next).unwrap();
            next.strftime("%Y-%m-%dT%H:%M:%S%:z").to_string()
        })
        .collect()
}
fn time(text: &str) -> Timestamp {
    text.parse().unwrap()
}

#[test]
fn five_fields_timezone_and_dst_defaults() {
    let now = time("2026-10-16T10:00:00.001Z");
    for cron in [
        "",
        "@daily",
        "* * * *",
        "0 * * * * *",
        "0 0 * * * 2027",
        "60 * * * *",
        "* 24 * * *",
        "nonsense * * * *",
    ] {
        assert!(
            matches!(Timing::new(cron, "UTC"), Err(TimingError::CronInvalid)),
            "{cron}"
        );
    }
    for zone in ["", "Not/AZone", "+08:00", " UTC "] {
        assert!(
            matches!(
                Timing::new("* * * * *", zone),
                Err(TimingError::TimezoneInvalid)
            ),
            "{zone}"
        );
    }
    assert_eq!(
        occurrences("0 3 * * *", "Asia/Shanghai", now),
        [
            "2026-10-17T03:00:00+08:00",
            "2026-10-18T03:00:00+08:00",
            "2026-10-19T03:00:00+08:00",
        ]
    );
    assert_eq!(
        occurrences(
            "30 2 * * *",
            "America/New_York",
            time("2026-03-07T12:00:00Z")
        ),
        [
            "2026-03-08T03:00:00-04:00",
            "2026-03-09T02:30:00-04:00",
            "2026-03-10T02:30:00-04:00",
        ]
    );
    assert_eq!(
        occurrences(
            "30 1 * * *",
            "America/New_York",
            time("2026-11-01T00:00:00Z")
        ),
        [
            "2026-11-01T01:30:00-04:00",
            "2026-11-02T01:30:00-05:00",
            "2026-11-03T01:30:00-05:00",
        ]
    );
}

#[tokio::test]
async fn synchronization_updates_declarations_and_preserves_unchanged_rows() {
    test_support::run(async |test| {
        test.upgrade(crate::migrations::MIGRATIONS, 1)
            .await
            .unwrap();
        let a = queue(test, Default::default());
        let b = queue(test, Default::default());
        let now = time("2026-10-16T10:00:00Z");
        let (left, right) = tokio::join!(a.sync_schedules(now), b.sync_schedules(now));
        left.unwrap();
        right.unwrap();
        assert_eq!(a.list_schedules().await.unwrap().len(), 1);
        let row = first(&a).await;
        let timezone = row.timezone.clone();
        assert!(row.declared && row.enabled);
        assert!(TimeZone::get(&row.timezone).is_ok());
        assert!(row.next_run_at.unwrap() > now);
        let initial = stored(&a).await;
        assert_eq!((initial.0, initial.1), (1, now));
        let later = time("2026-10-20T10:00:00Z");
        a.sync_schedules(later).await.unwrap();
        assert_eq!(stored(&a).await, initial);
        a.trigger_schedules(later).await.unwrap();
        let triggered = stored(&a).await;
        assert_eq!(triggered.3, Some(later));
        assert!(triggered.4.is_some());
        a.sync_schedules(later).await.unwrap();
        assert_eq!(stored(&a).await, triggered);

        let changed_at = time("2026-10-20T10:01:00Z");
        let declaration = ScheduleDeclaration {
            cron: "*/5 * * * *",
            ..DECLARATION
        };
        let changed = declared_queue(test, declaration);
        changed.sync_schedules(changed_at).await.unwrap();
        let row = first(&changed).await;
        let expected = timestamp(
            &Timing::new(declaration.cron, &row.timezone)
                .unwrap()
                .next(changed_at)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(row.cron, declaration.cron);
        assert_eq!(
            stored(&changed).await,
            (
                triggered.0 + 1,
                changed_at,
                Some(expected),
                triggered.3,
                triggered.4
            )
        );

        // 只改变任务类型和载荷时，已经排好的触发时间保持。
        let changed = declared_queue(
            test,
            ScheduleDeclaration {
                kind: "test.other",
                payload: r#"{"source":"new"}"#,
                ..declaration
            },
        );
        changed.sync_schedules(later).await.unwrap();
        let row: Record = test.db.fetch_optional(&query()).await.unwrap().unwrap();
        assert_eq!(row.kind, "test.other");
        assert_eq!(row.payload, r#"{"source":"new"}"#);
        assert_eq!(
            stored(&changed).await,
            (
                triggered.0 + 2,
                later,
                Some(expected),
                triggered.3,
                triggered.4
            )
        );

        let disabled = declared_queue(
            test,
            ScheduleDeclaration {
                enabled: false,
                ..declaration
            },
        );
        disabled.sync_schedules(later).await.unwrap();
        assert!(!first(&disabled).await.enabled);
        assert_eq!(
            stored(&disabled).await,
            (triggered.0 + 3, later, None, triggered.3, triggered.4)
        );
        let enabled = declared_queue(test, declaration);
        enabled.sync_schedules(changed_at).await.unwrap();
        assert_eq!(
            stored(&enabled).await,
            (
                triggered.0 + 4,
                changed_at,
                Some(expected),
                triggered.3,
                triggered.4
            )
        );

        test.db
            .execute(
                &Query::update()
                    .table("fw_job_schedule")
                    .value("next_run_at", Option::<i64>::None)
                    .to_owned(),
            )
            .await
            .unwrap();
        enabled.sync_schedules(changed_at).await.unwrap();
        assert_eq!(
            stored(&enabled).await,
            (
                triggered.0 + 5,
                changed_at,
                Some(expected),
                triggered.3,
                triggered.4
            )
        );
        test.db
            .execute(
                &Query::update()
                    .table("fw_job_schedule")
                    .value("timezone", "Not/AZone")
                    .to_owned(),
            )
            .await
            .unwrap();
        enabled.sync_schedules(changed_at).await.unwrap();
        assert_eq!(first(&enabled).await.timezone, timezone);
        assert!(TimeZone::get(&first(&enabled).await.timezone).is_ok());
        assert_eq!(
            stored(&enabled).await,
            (
                triggered.0 + 6,
                changed_at,
                Some(expected),
                triggered.3,
                triggered.4
            )
        );

        let removed = JobQueue::new(
            test.db.clone(),
            vec![],
            vec![],
            vec![],
            crate::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
        )
        .unwrap();
        let before = stored(&enabled).await;
        removed.sync_schedules(later).await.unwrap();
        assert_eq!(stored(&removed).await, before);
        assert!(!first(&removed).await.declared);
        assert_eq!(removed.list_schedules().await.unwrap().len(), 1);
    })
    .await;
}

#[tokio::test]
async fn invalid_declared_timing_is_an_internal_error() {
    test_support::run(async |test| {
        test.upgrade(crate::migrations::MIGRATIONS, 1)
            .await
            .unwrap();
        let queue = declared_queue(
            test,
            ScheduleDeclaration {
                cron: "invalid",
                ..DECLARATION
            },
        );
        assert_eq!(
            queue
                .sync_schedules(Timestamp::now())
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        assert!(queue.list_schedules().await.unwrap().is_empty());
    })
    .await;
}

#[tokio::test]
async fn run_now_requires_a_declaration_and_active_handler_and_keeps_timing() {
    test_support::run(async |test| {
        test.upgrade(crate::migrations::MIGRATIONS, 1).await.unwrap();
        let queue = declared_queue(test, ScheduleDeclaration { enabled: false, ..DECLARATION });
        queue.sync_schedules(Timestamp::now()).await.unwrap();
        let row = first(&queue).await;
        let before = stored(&queue).await;
        let user = Id::new();
        let job = queue.run_schedule_now(row.id, Some(user)).await.unwrap();
        assert_eq!(queue.get(job).await.unwrap().submitted_by, Some(user));
        assert_eq!(stored(&queue).await, before);
        assert!(matches!(queue.run_schedule_now(Id::new(), None).await, Err(ScheduleError::App(error)) if error.code() == DATA_NOT_FOUND));
        let instance = crate::instance::InstanceId::load_or_create(test.root.path()).unwrap();
        let removed = JobQueue::new(test.db.clone(), vec![], vec![], vec![], instance).unwrap();
        assert!(matches!(removed.run_schedule_now(row.id, None).await, Err(ScheduleError::Undeclared)));
        let inactive = JobQueue::new(test.db.clone(), vec![], vec![DECLARATION], vec![], instance).unwrap();
        assert!(matches!(inactive.run_schedule_now(row.id, None).await, Err(ScheduleError::App(error)) if error.code() == MODULE_DISABLED));
    }).await;
}

#[tokio::test]
async fn overdue_triggers_once_and_disabled_or_undeclared_never_trigger() {
    test_support::run(async |test| {
        test.upgrade(crate::migrations::MIGRATIONS, 1)
            .await
            .unwrap();
        let declaration = ScheduleDeclaration {
            cron: "*/5 * * * *",
            ..DECLARATION
        };
        let queue = declared_queue(test, declaration);
        let before = time("2026-10-01T10:00:00Z");
        let now = time("2026-10-16T10:00:00Z");
        queue.sync_schedules(before).await.unwrap();
        queue.trigger_schedules(now).await.unwrap();
        queue.trigger_schedules(now).await.unwrap();
        let row = first(&queue).await;
        let expected = timestamp(
            &Timing::new(declaration.cron, &row.timezone)
                .unwrap()
                .next(now)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(row.next_run_at, Some(expected));
        assert_eq!(row.last_run_at, Some(now));
        assert_eq!(row.last_job_status, Some(JobStatus::Queued));
        let job = queue.get(row.last_job_id.unwrap()).await.unwrap();
        assert!(job.submitted_by.is_none());
        assert_eq!(job.payload["source"], "schedule");
        let disabled = declared_queue(
            test,
            ScheduleDeclaration {
                enabled: false,
                ..declaration
            },
        );
        disabled.sync_schedules(now).await.unwrap();
        disabled
            .trigger_schedules(time("2026-10-20T00:00:00Z"))
            .await
            .unwrap();
        queue.sync_schedules(now).await.unwrap();
        let removed = JobQueue::new(
            test.db.clone(),
            vec![Arc::new(Handler(Default::default()))],
            vec![],
            vec![],
            crate::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
        )
        .unwrap();
        removed
            .trigger_schedules(time("2026-10-20T00:00:00Z"))
            .await
            .unwrap();
        assert_eq!(
            queue
                .list(
                    PageRequest {
                        page: 1,
                        page_size: 20
                    },
                    None,
                    None
                )
                .await
                .unwrap()
                .total,
            1
        );
    })
    .await;
}

#[tokio::test]
async fn two_executors_share_one_schedule_trigger() {
    test_support::run(async |test| {
        test.upgrade(crate::migrations::MIGRATIONS, 1)
            .await
            .unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let a = queue(test, count.clone());
        let b = queue(test, count.clone());
        a.sync_schedules(Timestamp::now()).await.unwrap();
        let row = first(&a).await;
        test.db
            .execute(
                &update(row.id, Timestamp::now())
                    .value("next_run_at", 0_i64)
                    .to_owned(),
            )
            .await
            .unwrap();
        let (left, right) = tokio::join!(
            JobRunner::start(
                a.clone(),
                Arc::new(Permission),
                JobsConfig::new(4, 30).unwrap(),
                crate::maintenance::OperationGate::default(),
            ),
            JobRunner::start(
                b,
                Arc::new(Permission),
                JobsConfig::new(4, 30).unwrap(),
                crate::maintenance::OperationGate::default(),
            ),
        );
        let (left, right) = (left.unwrap(), right.unwrap());
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(job) = first(&a).await.last_job_id
                    && a.get(job).await.unwrap().status == JobStatus::Succeeded
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        left.stop().await.unwrap();
        right.stop().await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(
            a.list(
                PageRequest {
                    page: 1,
                    page_size: 20
                },
                None,
                None
            )
            .await
            .unwrap()
            .total,
            1
        );
    })
    .await;
}

#[tokio::test]
async fn invalid_persistent_schedules_return_invalid_state() {
    test_support::run(async |test| {
        test.upgrade(crate::migrations::MIGRATIONS, 1).await.unwrap();
        let queue = queue(test, Default::default());
        let now = Timestamp::now();
        for (column, value) in [("kind", "invalid"), ("payload", "{invalid"), ("cron", "invalid"), ("timezone", "Not/AZone")] {
            queue.sync_schedules(now).await.unwrap();
            let schedule = first(&queue).await;
            test.db.execute(&update(schedule.id, now).value(column, value).value("next_run_at", 0_i64).to_owned()).await.unwrap();
            assert_eq!(queue.trigger_schedules(now).await.unwrap_err().code(), INVALID_STATE, "{column}");
            if column == "kind" {
                assert!(matches!(queue.run_schedule_now(schedule.id, None).await, Err(ScheduleError::App(error)) if error.code() == INVALID_STATE));
                assert_eq!(queue.list_schedules().await.unwrap_err().code(), INVALID_STATE);
            }
        }
        queue.sync_schedules(now).await.unwrap();
        let schedule = first(&queue).await;
        test.db.execute(&update(schedule.id, now).value("next_run_at", Option::<i64>::None).to_owned()).await.unwrap();
        let record: Record = test.db.fetch_optional(&query()).await.unwrap().unwrap();
        assert_eq!(DueSchedule::try_from(record).err().unwrap().code(), INVALID_STATE);
    }).await;
}
