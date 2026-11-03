use super::{input, queue, success};
use crate::{
    actor::Actor,
    db::test_support::{self, TestDb},
    error::{AppError, DATA_NOT_FOUND},
    id::Id,
    job::*,
    stream::{StreamEvent, StreamOwner, StreamRegistry, StreamSink},
};
use sea_query::{Expr, ExprTrait, Query};
use serde_json::json;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

fn observer(actor: Actor) -> StreamOwner {
    StreamOwner {
        actor,
        scope: "main".into(),
    }
}

#[test]
fn state_changes_use_the_framework_error_contract() {
    changed(true).unwrap();
    assert_eq!(changed(false).unwrap_err().code(), INVALID_STATE);
    assert_eq!(INVALID_STATE.as_str(), "app.job.invalid_state");
}

#[tokio::test]
async fn own_jobs_hide_other_and_system_tasks_and_reuse_cancellation_and_watch() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let actor = Actor::User(Id::new());
        let Actor::User(owner) = actor else {
            panic!("owner")
        };
        let mut ids = Vec::new();
        for submitted_by in [Some(owner), Some(Id::new()), None] {
            ids.push(
                queue
                    .submit(
                        &test.db,
                        SubmitJob {
                            kind: "test.one".into(),
                            payload: json!({}),
                            priority: 0,
                            run_after: None,
                            submitted_by,
                        },
                    )
                    .await
                    .unwrap(),
            );
        }
        for id in [ids[1], ids[2], Id::new()] {
            assert_eq!(
                get_mine(&queue, actor, id).await.unwrap_err().code(),
                DATA_NOT_FOUND
            );
            assert_eq!(
                cancel_mine(&queue, actor, id).await.unwrap_err().code(),
                DATA_NOT_FOUND
            );
            let (sender, _events) = tokio::sync::mpsc::unbounded_channel();
            let streams = StreamRegistry::default();
            let stream = streams.open(observer(actor), Sink(sender)).unwrap();
            assert_eq!(
                watch_mine(&queue, actor, id, &stream, || async { Ok(()) })
                    .await
                    .unwrap_err()
                    .code(),
                DATA_NOT_FOUND
            );
        }
        for id in &ids {
            assert_eq!(
                require_mine(&queue, Actor::System, *id)
                    .await
                    .unwrap_err()
                    .code(),
                DATA_NOT_FOUND
            );
        }
        assert_eq!(get_mine(&queue, actor, ids[0]).await.unwrap().id, ids[0]);
        cancel_mine(&queue, actor, ids[0]).await.unwrap();
        assert_eq!(
            queue.get(ids[0]).await.unwrap().status,
            JobStatus::Cancelled
        );
        assert_eq!(
            cancel_mine(&queue, actor, ids[0]).await.unwrap_err().code(),
            INVALID_STATE
        );
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
        let streams = StreamRegistry::default();
        let stream = streams.open(observer(actor), Sink(sender)).unwrap();
        watch_mine(&queue, actor, ids[0], &stream, || async { Ok(()) })
            .await
            .unwrap();
        let mut cancelled = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, StreamEvent::Cancelled) {
                cancelled = true;
            }
        }
        assert!(cancelled);
        state(test, ids[0], "running").await;
        cancel_mine(&queue, actor, ids[0]).await.unwrap();
        assert!(queue.get(ids[0]).await.unwrap().cancel_requested);
    })
    .await;
}

async fn state(test: &TestDb, id: Id, status: &str) {
    test.db
        .execute(
            &Query::update()
                .table("fw_job")
                .value("status", status)
                .value(
                    "started_at",
                    (status == "running").then_some(crate::time::Timestamp::now().as_millis()),
                )
                .value("lease_owner", (status == "running").then_some("watch-test"))
                .value("attempts", i32::from(status == "running"))
                .value("row_version", Expr::col("row_version").add(1_i64))
                .and_where(Expr::col("id").eq(id))
                .to_owned(),
        )
        .await
        .unwrap();
}

struct Sink(tokio::sync::mpsc::UnboundedSender<StreamEvent<JobEvent>>);
impl StreamSink<JobEvent> for Sink {
    fn send(&self, event: StreamEvent<JobEvent>) -> Result<(), AppError> {
        self.0.send(event).unwrap();
        Ok(())
    }
}

#[tokio::test]
async fn watch_starts_with_snapshot_and_ends_or_cancels_without_cancelling_job() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let streams = StreamRegistry::default();
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
        let stream = streams.open(observer(Actor::System), Sink(sender)).unwrap();
        let stream_id = stream.id;
        let observed = queue.clone();
        let task = tokio::spawn(async move {
            watch(&observed, id, &stream, || async { Ok(()) })
                .await
                .unwrap();
        });
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Started { .. }
        ));
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Progress { .. }
        ));
        streams.cancel(&observer(Actor::System), stream_id).unwrap();
        task.await.unwrap();
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Cancelled
        ));
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Queued);
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
        let stream = streams.open(observer(Actor::System), Sink(sender)).unwrap();
        let observed = queue.clone();
        let task = tokio::spawn(async move {
            watch(&observed, id, &stream, || async { Ok(()) })
                .await
                .unwrap();
        });
        events.recv().await.unwrap();
        events.recv().await.unwrap();
        changed(queue.cancel(id).await.unwrap()).unwrap();
        task.await.unwrap();
        let mut ended = false;
        while let Some(event) = events.recv().await {
            if matches!(event, StreamEvent::Cancelled) {
                ended = true;
            }
        }
        assert!(ended);
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
        let stream = streams.open(observer(Actor::System), Sink(sender)).unwrap();
        watch(&queue, id, &stream, || async { Ok(()) })
            .await
            .unwrap();
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Started { .. }
        ));
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Progress { .. }
        ));
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Cancelled
        ));
    })
    .await;
}

#[tokio::test]
async fn watch_terminal_snapshots_and_changes_without_local_broadcast() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let streams = StreamRegistry::default();
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
        let stream = streams.open(observer(Actor::System), Sink(sender)).unwrap();
        let observed = queue.clone();
        let task = tokio::spawn(async move { watch(&observed, id, &stream, || async { Ok(()) }).await.unwrap(); });
        events.recv().await.unwrap(); events.recv().await.unwrap();
        state(test, id, "succeeded").await;
        tokio::time::timeout(std::time::Duration::from_secs(5), task).await.unwrap().unwrap();
        let mut succeeded = false;
        while let Some(event) = events.recv().await { if matches!(event, StreamEvent::Succeeded{..}) { succeeded = true; } }
        assert!(succeeded);
        test.db.execute(&Query::update().table("fw_job").value("error_code", "app.input.invalid").value("error_params", r#"{"path":"payload"}"#).and_where(Expr::col("id").eq(id)).to_owned()).await.unwrap();
        for status in ["succeeded", "failed", "needs_review"] {
            state(test, id, status).await;
            let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
            let stream = streams.open(observer(Actor::System), Sink(sender)).unwrap();
            watch(&queue, id, &stream, || async { Ok(()) }).await.unwrap();
            events.recv().await.unwrap(); events.recv().await.unwrap();
            let ending = events.recv().await.unwrap();
            match status {
                "succeeded" => assert!(matches!(ending, StreamEvent::Succeeded{..})),
                "failed" => assert!(matches!(ending, StreamEvent::Failed{ref code,ref params} if code=="app.input.invalid" && params["path"]=="payload")),
                _ => assert!(matches!(ending, StreamEvent::Unknown{ref reason} if reason=="jobs.needsReview")),
            }
        }
    }).await;
}

#[tokio::test]
async fn job_observer_cancel_keeps_execution() {
    use std::{sync::Arc, time::Duration};
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    test_support::run(async |test| {
        tokio::time::timeout(Duration::from_secs(5), async {
            let entered = Arc::new(Notify::new());
            let finish = Arc::new(Notify::new());
            let handler = super::handler("test.one", false, {
                let entered = entered.clone();
                let finish = finish.clone();
                move |context| {
                    let entered = entered.clone();
                    let finish = finish.clone();
                    Box::pin(async move {
                        entered.notify_one();
                        finish.notified().await;
                        assert!(!context.cancellation.is_cancelled());
                        Ok(json!({"ok": true}))
                    })
                }
            });
            let queue = queue(test, vec![handler.clone()]).await;
            let user = Id::new();
            let actor = Actor::User(user);
            let id = queue
                .submit(
                    &test.db,
                    SubmitJob {
                        submitted_by: Some(user),
                        ..input("test.one")
                    },
                )
                .await
                .unwrap();
            let job = super::claim(&queue, id).await;
            let execution = tokio::spawn(super::run_job(
                queue.clone(),
                handler,
                Arc::new(super::Permission(true)),
                job,
                10,
                CancellationToken::new(),
            ));
            entered.notified().await;
            let streams = StreamRegistry::default();
            let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
            let stream = streams.open(observer(actor), Sink(sender)).unwrap();
            let stream_id = stream.id;
            let observed = queue.clone();
            let watch = tokio::spawn(async move {
                watch_mine(&observed, actor, id, &stream, || async { Ok(()) }).await
            });
            assert!(matches!(
                events.recv().await.unwrap(),
                StreamEvent::Started { .. }
            ));
            assert!(matches!(
                events.recv().await.unwrap(),
                StreamEvent::Progress { .. }
            ));
            assert_eq!(
                get_mine(&queue, Actor::User(Id::new()), id)
                    .await
                    .unwrap_err()
                    .code(),
                DATA_NOT_FOUND
            );
            streams.cancel(&observer(actor), stream_id).unwrap();
            watch.await.unwrap().unwrap();
            assert!(matches!(
                events.recv().await.unwrap(),
                StreamEvent::Cancelled
            ));
            assert!(events.recv().await.is_none());
            let running = queue.get(id).await.unwrap();
            assert_eq!(running.status, JobStatus::Running);
            assert!(!running.cancel_requested);
            finish.notify_one();
            execution.await.unwrap().unwrap();
            assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Succeeded);
        })
        .await
        .unwrap();
    })
    .await;
}

#[tokio::test]
async fn watch_revocation_on_idle_tick_ends_observation_without_changing_job() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let streams = StreamRegistry::default();
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
        let stream = streams.open(observer(Actor::System), Sink(sender)).unwrap();
        let authorized = Arc::new(AtomicBool::new(true));
        let allowed = authorized.clone();
        let observed = queue.clone();
        let mut task = tokio::spawn(async move {
            watch(&observed, id, &stream, || async {
                if allowed.load(Ordering::SeqCst) {
                    Ok(())
                } else {
                    Err(AppError::new(crate::error::PERMISSION_DENIED))
                }
            })
            .await
        });
        assert!(matches!(events.recv().await.unwrap(), StreamEvent::Started { .. }));
        assert!(matches!(events.recv().await.unwrap(), StreamEvent::Progress { .. }));
        authorized.store(false, Ordering::SeqCst);
        // 一个轮询周期，另留 100ms 给测试调度和数据库往返。
        let ended = tokio::time::timeout(Duration::from_millis(1100), &mut task).await;
        if ended.is_err() {
            task.abort();
            let _ = task.await;
        }
        assert_eq!(ended.unwrap().unwrap().unwrap_err().code(), crate::error::PERMISSION_DENIED);
        assert!(matches!(events.recv().await.unwrap(), StreamEvent::Failed { code, .. } if code == "app.permission.denied"));
        assert!(events.recv().await.is_none());
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Queued);
        state(test, id, "succeeded").await;
        assert!(events.recv().await.is_none());
    }).await;
}

struct RevokeOnProgress {
    sender: tokio::sync::mpsc::UnboundedSender<StreamEvent<JobEvent>>,
    authorized: Arc<AtomicBool>,
    revoke: Arc<AtomicBool>,
}

impl StreamSink<JobEvent> for RevokeOnProgress {
    fn send(&self, event: StreamEvent<JobEvent>) -> Result<(), AppError> {
        if matches!(event, StreamEvent::Progress { .. }) && self.revoke.load(Ordering::SeqCst) {
            self.authorized.store(false, Ordering::SeqCst);
        }
        self.sender.send(event).unwrap();
        Ok(())
    }
}

#[tokio::test]
async fn cancelled_watch_does_not_read_closed_database() {
    for mine in [false, true] {
        test_support::run(async |test| {
            let queue = queue(test, vec![success()]).await;
            let owner = Id::new();
            let actor = Actor::User(owner);
            let id = queue
                .submit(
                    &test.db,
                    SubmitJob {
                        submitted_by: Some(owner),
                        ..input("test.one")
                    },
                )
                .await
                .unwrap();
            let streams = StreamRegistry::default();
            let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
            let stream = streams.open(observer(actor), Sink(sender)).unwrap();
            assert!(matches!(
                events.recv().await.unwrap(),
                StreamEvent::Started { .. }
            ));

            // 固定调度：关闭流并完成关库后，才允许监视 future 首次运行。
            streams.close().unwrap();
            test.db.close().await;
            let authorize = || require_mine(&queue, actor, id);
            let result = if mine {
                watch_mine(&queue, actor, id, &stream, authorize).await
            } else {
                watch(&queue, id, &stream, authorize).await
            };
            let ending = events.try_recv();
            assert!(
                matches!(ending, Ok(StreamEvent::Cancelled)),
                "{ending:?}; {result:?}"
            );
            result.unwrap();
            drop(stream);
            assert!(events.recv().await.is_none());
        })
        .await;
    }
}

#[tokio::test]
async fn watch_cancellation_interrupts_authorization_before_database_closes() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let streams = StreamRegistry::default();
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
        let authorized = Arc::new(AtomicBool::new(true));
        let stream = streams
            .open(
                observer(Actor::System),
                RevokeOnProgress {
                    sender,
                    authorized: authorized.clone(),
                    revoke: Arc::new(AtomicBool::new(true)),
                },
            )
            .unwrap();
        let entered = tokio::sync::Notify::new();
        let resume = tokio::sync::Notify::new();
        let mut watching = std::pin::pin!(watch(&queue, id, &stream, || async {
            if !authorized.load(Ordering::SeqCst) {
                entered.notify_one();
                resume.notified().await;
            }
            queue.get(id).await.map(|_| ())
        }));
        tokio::time::timeout(Duration::from_secs(5), async {
            tokio::select! {
                result = &mut watching => panic!("watch ended before shutdown: {result:?}"),
                _ = entered.notified() => {},
            }
        })
        .await
        .unwrap();
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Started { .. }
        ));
        assert!(matches!(
            events.recv().await.unwrap(),
            StreamEvent::Progress { .. }
        ));

        // 已进入快照后的授权复核，但尚未查库；关库后再释放等待点。
        streams.close().unwrap();
        test.db.close().await;
        resume.notify_one();
        let result = tokio::time::timeout(Duration::from_secs(5), &mut watching)
            .await
            .unwrap();
        let ending = events.try_recv();
        assert!(
            matches!(ending, Ok(StreamEvent::Cancelled)),
            "{ending:?}; {result:?}"
        );
        result.unwrap();
        assert!(events.try_recv().is_err());
    })
    .await;
}

#[tokio::test]
async fn watch_rechecks_authorization_before_initial_progress_delta_and_terminal() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        for phase in ["initial", "delta", "terminal", "snapshot-terminal"] {
            let id = queue.submit(&test.db, input("test.one")).await.unwrap();
            let authorized = Arc::new(AtomicBool::new(phase != "initial"));
            let revoke = Arc::new(AtomicBool::new(phase == "snapshot-terminal"));
            if phase == "snapshot-terminal" {
                state(test, id, "succeeded").await;
            }
            let streams = StreamRegistry::default();
            let (sender, mut events) = tokio::sync::mpsc::unbounded_channel();
            let stream = streams.open(observer(Actor::System), RevokeOnProgress {
                sender,
                authorized: authorized.clone(),
                revoke: revoke.clone(),
            }).unwrap();
            let observed = queue.clone();
            let mut task = tokio::spawn(async move {
                watch(&observed, id, &stream, || async {
                    if authorized.load(Ordering::SeqCst) {
                        Ok(())
                    } else {
                        Err(AppError::new(crate::error::PERMISSION_DENIED))
                    }
                }).await
            });
            assert!(matches!(events.recv().await.unwrap(), StreamEvent::Started { .. }));
            if phase != "initial" {
                assert!(matches!(events.recv().await.unwrap(), StreamEvent::Progress { .. }));
            }
            if matches!(phase, "delta" | "terminal") {
                revoke.store(true, Ordering::SeqCst);
                state(test, id, if phase == "delta" { "running" } else { "succeeded" }).await;
                assert!(matches!(tokio::time::timeout(Duration::from_millis(1100), events.recv()).await.unwrap().unwrap(), StreamEvent::Progress { .. }));
            }
            let ended = tokio::time::timeout(Duration::from_millis(1100), &mut task).await;
            if ended.is_err() {
                task.abort();
                let _ = task.await;
            }
            assert_eq!(ended.unwrap().unwrap().unwrap_err().code(), crate::error::PERMISSION_DENIED, "{phase}");
            assert!(matches!(events.recv().await.unwrap(), StreamEvent::Failed { code, .. } if code == "app.permission.denied"), "{phase}");
            assert!(events.recv().await.is_none(), "{phase}");
        }
    }).await;
}
