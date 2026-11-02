use super::*;
use crate::db::Tx;
use std::sync::atomic::AtomicBool;

struct PausedCompletion {
    transaction_entered: Arc<tokio::sync::Notify>,
    transaction_resume: Arc<tokio::sync::Notify>,
    callback_entered: Arc<tokio::sync::Notify>,
    callback_resume: Arc<tokio::sync::Notify>,
}

impl JobCompletionHook for PausedCompletion {
    fn complete<'a>(
        &'a self,
        _tx: &'a mut Tx<'_>,
        _queue: &'a JobQueue,
        _job: &'a JobSnapshot,
    ) -> JobCompletionFuture<'a> {
        Box::pin(async move {
            self.transaction_entered.notify_one();
            self.transaction_resume.notified().await;
            let entered = self.callback_entered.clone();
            let resume = self.callback_resume.clone();
            Ok(Some(Box::pin(async move {
                entered.notify_one();
                resume.notified().await;
                Ok(())
            }) as AfterJobCommit))
        })
    }
}

#[tokio::test]
async fn gate_covers_ipc_and_job_callbacks() {
    use crate::maintenance::{OPERATION_BUSY, OperationGate};
    use tokio::{sync::Notify, time::timeout};

    test_support::run(async |test| {
        let executing = Arc::new(Notify::new());
        let resume = Arc::new(Notify::new());
        let entered = executing.clone();
        let release = resume.clone();
        let handler = handler("test.one", false, move |_| {
            let entered = entered.clone();
            let release = release.clone();
            Box::pin(async move {
                entered.notify_one();
                release.notified().await;
                Ok(json!("done"))
            })
        });
        let queue = queue(test, vec![handler]).await;
        let hook = Arc::new(PausedCompletion {
            transaction_entered: Arc::new(Notify::new()),
            transaction_resume: Arc::new(Notify::new()),
            callback_entered: Arc::new(Notify::new()),
            callback_resume: Arc::new(Notify::new()),
        });
        let queue = with_hooks(queue, vec![hook.clone()]);
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let gate = OperationGate::default();
        let runner = JobRunner::start(
            queue.clone(),
            Arc::new(Permission(true)),
            JobsConfig::new(4, 30).unwrap(),
            gate.clone(),
        )
        .await
        .unwrap();
        timeout(Duration::from_secs(2), executing.notified())
            .await
            .unwrap();
        let maintenance = gate.quiesce();
        tokio::pin!(maintenance);
        assert!(
            timeout(Duration::from_millis(10), &mut maintenance)
                .await
                .is_err()
        );
        assert_eq!(gate.enter().err().unwrap().code(), OPERATION_BUSY);
        resume.notify_one();
        timeout(Duration::from_secs(2), hook.transaction_entered.notified())
            .await
            .unwrap();
        assert!(
            timeout(Duration::from_millis(10), &mut maintenance)
                .await
                .is_err()
        );
        hook.transaction_resume.notify_one();
        timeout(Duration::from_secs(2), hook.callback_entered.notified())
            .await
            .unwrap();
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Succeeded);
        assert!(
            timeout(Duration::from_millis(10), &mut maintenance)
                .await
                .is_err()
        );
        hook.callback_resume.notify_one();
        let exclusive = timeout(Duration::from_secs(2), maintenance)
            .await
            .unwrap()
            .unwrap();
        runner.stop().await.unwrap();
        drop(exclusive);
        gate.close().await;
    })
    .await;
}

struct Hook {
    db: Db,
    fail: AtomicBool,
    calls: AtomicUsize,
    committed: Arc<AtomicUsize>,
}

impl JobCompletionHook for Hook {
    fn complete<'a>(
        &'a self,
        tx: &'a mut Tx<'_>,
        _queue: &'a JobQueue,
        job: &'a JobSnapshot,
    ) -> JobCompletionFuture<'a> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let (status,): (String,) = tx
                .fetch_optional(
                    &store::query()
                        .clear_selects()
                        .column("status")
                        .and_where(Expr::col("id").eq(job.id))
                        .to_owned(),
                )
                .await?
                .unwrap();
            assert_eq!(status, job.status.as_str());
            tx.execute(
                &store::update(job.id)
                    .value("payload", "{\"hook\":true}")
                    .to_owned(),
            )
            .await?;
            if self.fail.swap(false, Ordering::SeqCst) {
                return Err(AppError::new(INTERNAL_UNEXPECTED));
            }
            let db = self.db.clone();
            let id = job.id;
            let committed = self.committed.clone();
            Ok(Some(Box::pin(async move {
                let (saved,): (String,) = db
                    .fetch_optional(
                        &store::query()
                            .clear_selects()
                            .column("status")
                            .and_where(Expr::col("id").eq(id))
                            .to_owned(),
                    )
                    .await?
                    .unwrap();
                assert_eq!(saved, status);
                committed.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }) as AfterJobCommit))
        })
    }
}

fn install(queue: JobQueue, fail: bool) -> (JobQueue, Arc<Hook>) {
    let hook = Arc::new(Hook {
        db: queue.0.db.clone(),
        fail: AtomicBool::new(fail),
        calls: AtomicUsize::new(0),
        committed: Arc::new(AtomicUsize::new(0)),
    });
    let queue = with_hooks(queue, vec![hook.clone()]);
    (queue, hook)
}

#[tokio::test]
async fn disabled_job_kind_rejects_cancel_retry_and_resolve_without_mutation() {
    test_support::run(async |test| {
        let enabled = queue(test, vec![success()]).await;
        let (enabled, enabled_hook) = install(enabled, false);
        let disabled = JobQueue::new(
            test.db.clone(),
            vec![],
            vec![],
            vec![],
            enabled.0.instance_id,
        )
        .unwrap();
        let (disabled, disabled_hook) = install(disabled, false);
        let mut ids = vec![];
        for status in [
            JobStatus::Queued,
            JobStatus::Running,
            JobStatus::NeedsReview,
        ] {
            let id = enabled.submit(&test.db, input("test.one")).await.unwrap();
            if status != JobStatus::Queued {
                claim(&enabled, id).await;
                test.db
                    .execute(
                        &store::update(id)
                            .value("status", status.as_str())
                            .to_owned(),
                    )
                    .await
                    .unwrap();
            }
            let token = CancellationToken::new();
            disabled.0.running.lock().unwrap().insert(id, token.clone());
            let before = serde_json::to_value(enabled.get(id).await.unwrap()).unwrap();
            let lease_query = Query::select()
                .columns(["lease_owner", "lease_expires_at", "instance_id"])
                .from("fw_job")
                .and_where(Expr::col("id").eq(id))
                .to_owned();
            let lease: Option<(Option<String>, Option<i64>, Option<String>)> =
                test.db.fetch_optional(&lease_query).await.unwrap();
            for result in [
                disabled.cancel(id).await,
                disabled.retry(id).await,
                disabled.resolve(id, true, INTERNAL_UNEXPECTED).await,
            ] {
                let error = result.unwrap_err();
                assert_eq!(error.code(), crate::error::MODULE_DISABLED);
                assert_eq!(error.params.get("module").map(String::as_str), Some("test"));
                assert!(!token.is_cancelled());
                assert_eq!(
                    serde_json::to_value(enabled.get(id).await.unwrap()).unwrap(),
                    before
                );
                assert_eq!(
                    test.db
                        .fetch_optional::<(Option<String>, Option<i64>, Option<String>)>(
                            &lease_query
                        )
                        .await
                        .unwrap(),
                    lease
                );
            }
            ids.push(id);
        }
        assert_eq!(disabled_hook.calls.load(Ordering::SeqCst), 0);
        assert_eq!(disabled_hook.committed.load(Ordering::SeqCst), 0);
        assert!(enabled.cancel(ids[0]).await.unwrap());
        assert_eq!(
            enabled.get(ids[0]).await.unwrap().payload,
            json!({"hook":true})
        );
        assert_eq!(enabled_hook.committed.load(Ordering::SeqCst), 1);
        assert!(
            enabled
                .resolve(ids[2], false, INTERNAL_UNEXPECTED)
                .await
                .unwrap()
        );
        assert!(enabled.retry(ids[2]).await.unwrap());
        assert!(enabled.cancel(ids[2]).await.unwrap());
        assert_eq!(enabled_hook.committed.load(Ordering::SeqCst), 2);
    })
    .await;
}

#[tokio::test]
async fn reconcile_skips_unavailable_handlers_but_keeps_cross_instance_reconciliation() {
    test_support::run(async |test| {
        let mut handlers = vec![];
        for (kind, safe) in [
            ("test.one", true),
            ("test.unsafe", false),
            ("disabled.safe", true),
            ("disabled.unsafe", false),
        ] {
            let mut handler = handler(kind, safe, |_| {
                panic!("reconciliation must not run the handler")
            });
            Arc::get_mut(&mut handler).unwrap().local_only = true;
            handlers.push(handler as Arc<dyn JobHandler>);
        }
        let first = queue(test, handlers.clone()).await;
        let mut ids = vec![];
        for kind in [
            "test.one",
            "test.unsafe",
            "disabled.safe",
            "disabled.unsafe",
        ] {
            let id = first.submit(&test.db, input(kind)).await.unwrap();
            claim(&first, id).await;
            test.db
                .execute(
                    &store::update(id)
                        .value("lease_expires_at", 0_i64)
                        .to_owned(),
                )
                .await
                .unwrap();
            ids.push(id);
        }
        let other = test.root.path().join("other-instance");
        std::fs::create_dir(&other).unwrap();
        let second = JobQueue::new(
            test.db.clone(),
            handlers[..2].to_vec(),
            vec![],
            vec![],
            crate::instance::InstanceId::load_or_create(&other).unwrap(),
        )
        .unwrap();
        assert_ne!(first.0.instance_id, second.0.instance_id);
        let (second, hook) = install(second, false);
        let mut unavailable = vec![];
        for id in &ids[2..] {
            unavailable.push(serde_json::to_value(first.get(*id).await.unwrap()).unwrap());
        }
        second.reconcile(Timestamp::now()).await.unwrap();
        assert_eq!(first.get(ids[0]).await.unwrap().status, JobStatus::Queued);
        let terminal = first.get(ids[1]).await.unwrap();
        assert_eq!(terminal.status, JobStatus::NeedsReview);
        assert_eq!(terminal.payload, json!({"hook":true}));
        assert_eq!(hook.calls.load(Ordering::SeqCst), 1);
        assert_eq!(hook.committed.load(Ordering::SeqCst), 1);
        for (id, before) in ids[2..].iter().zip(unavailable) {
            assert_eq!(
                serde_json::to_value(first.get(*id).await.unwrap()).unwrap(),
                before
            );
            let lease: (String, i64, String) = test
                .db
                .fetch_optional(
                    &Query::select()
                        .columns(["lease_owner", "lease_expires_at", "instance_id"])
                        .from("fw_job")
                        .and_where(Expr::col("id").eq(*id))
                        .to_owned(),
                )
                .await
                .unwrap()
                .unwrap();
            assert_eq!(lease, ("owner".into(), 0, first.0.instance_id.to_string()));
        }
        assert!(
            second
                .candidates(Timestamp::now())
                .await
                .unwrap()
                .is_empty()
        );
    })
    .await;
}

#[tokio::test]
async fn queued_cancel_commits_cleanup_and_rolls_back_on_hook_failure() {
    test_support::run(async |test| {
        let handler = handler("test.one", false, |_| {
            panic!("cancelled queued job must not run")
        });
        let queue = queue(test, vec![handler]).await;
        let (queue, hook) = install(queue, true);
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        assert!(queue.cancel(id).await.is_err());
        let saved = queue.get(id).await.unwrap();
        assert_eq!(saved.status, JobStatus::Queued);
        assert_eq!(saved.payload, json!({}));
        assert_eq!(hook.committed.load(Ordering::SeqCst), 0);
        assert!(queue.cancel(id).await.unwrap());
        let saved = queue.get(id).await.unwrap();
        assert_eq!(saved.status, JobStatus::Cancelled);
        assert_eq!(saved.payload, json!({"hook":true}));
        assert_eq!(hook.committed.load(Ordering::SeqCst), 1);
        assert!(!queue.cancel(id).await.unwrap());
        assert_eq!(hook.committed.load(Ordering::SeqCst), 1);
    })
    .await;
}

#[tokio::test]
async fn completion_is_transactional_and_failed_hook_retries_without_rerunning_handler() {
    test_support::run(async |test| {
        let runs = Arc::new(AtomicUsize::new(0));
        let tracked = runs.clone();
        let handler = handler("test.one", false, move |_| {
            tracked.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(json!("done")) })
        });
        let queue = queue(test, vec![handler]).await;
        let (queue, hook) = install(queue, true);
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        assert!(
            finish(&queue, &job, false, &Ok(json!("done")), None)
                .await
                .is_err()
        );
        let saved = queue.get(id).await.unwrap();
        assert_eq!(saved.status, JobStatus::Running);
        assert_eq!(saved.payload, json!({}));
        assert!(saved.result.is_none());
        assert_eq!(hook.committed.load(Ordering::SeqCst), 0);
        finish(&queue, &job, false, &Ok(json!("done")), None)
            .await
            .unwrap();
        assert_eq!(queue.get(id).await.unwrap().payload, json!({"hook":true}));
        assert_eq!(hook.committed.load(Ordering::SeqCst), 1);
        hook.fail.store(true, Ordering::SeqCst);
        let next = queue.submit(&test.db, input("test.one")).await.unwrap();
        let runner = JobRunner::start(
            queue.clone(),
            Arc::new(Permission(true)),
            JobsConfig::new(4, 30).unwrap(),
            crate::maintenance::OperationGate::default(),
        )
        .await
        .unwrap();
        assert_eq!(
            wait(&queue, next, JobStatus::Succeeded).await.result,
            Some(json!("done"))
        );
        runner.stop().await.unwrap();
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        assert_eq!(hook.calls.load(Ordering::SeqCst), 4);
        assert_eq!(hook.committed.load(Ordering::SeqCst), 2);
    })
    .await;
}

#[tokio::test]
async fn completion_covers_failure_cancellation_and_expiry_but_not_takeover_or_requeue() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let (queue, hook) = install(queue, false);
        for status in [
            JobStatus::Failed,
            JobStatus::Cancelled,
            JobStatus::NeedsReview,
        ] {
            let id = queue.submit(&test.db, input("test.one")).await.unwrap();
            let mut job = claim(&queue, id).await;
            job.snapshot.retry_safe = false;
            if status == JobStatus::NeedsReview {
                test.db
                    .execute(
                        &store::update(id)
                            .value("retry_safe", false)
                            .value("lease_expires_at", 0_i64)
                            .to_owned(),
                    )
                    .await
                    .unwrap();
                hook.fail.store(true, Ordering::SeqCst);
                assert!(queue.reconcile(Timestamp::now()).await.is_err());
                assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Running);
                queue.reconcile(Timestamp::now()).await.unwrap();
            } else {
                finish(
                    &queue,
                    &job,
                    status == JobStatus::Cancelled,
                    &Err(AppError::new(INTERNAL_UNEXPECTED)),
                    None,
                )
                .await
                .unwrap();
            }
            assert_eq!(queue.get(id).await.unwrap().status, status);
        }
        let count = hook.calls.load(Ordering::SeqCst);
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        test.db
            .execute(&store::update(id).value("lease_owner", "other").to_owned())
            .await
            .unwrap();
        finish(&queue, &job, false, &Ok(json!("stale")), None)
            .await
            .unwrap();
        assert_eq!(hook.calls.load(Ordering::SeqCst), count);
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        finish(
            &queue,
            &job,
            false,
            &Err(AppError::new(INTERNAL_UNEXPECTED)),
            None,
        )
        .await
        .unwrap();
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Queued);
        assert_eq!(hook.calls.load(Ordering::SeqCst), count);
        assert_eq!(hook.committed.load(Ordering::SeqCst), 3);
    })
    .await;
}

fn with_hooks(queue: JobQueue, hooks: Vec<Arc<dyn JobCompletionHook>>) -> JobQueue {
    JobQueue::new(
        queue.0.db.clone(),
        queue
            .0
            .handlers
            .values()
            .map(|item| item.handler.clone())
            .collect(),
        queue
            .0
            .schedules
            .values()
            .map(|item| item.declaration)
            .collect(),
        hooks,
        queue.0.instance_id,
    )
    .unwrap()
}
