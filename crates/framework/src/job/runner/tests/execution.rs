use super::*;

#[tokio::test]
async fn failure_result_is_written_only_for_final_failed_state() {
    test_support::run(async |test| {
        for (safe, cancelled, status) in [
            (false, false, JobStatus::Failed),
            (true, false, JobStatus::Queued),
            (false, true, JobStatus::Cancelled),
        ] {
            let handler = handler("test.one", safe, move |context| {
                Box::pin(async move {
                    context.set_failure_result(json!({"errors":["invalid"]}))?;
                    Err(AppError::new(if cancelled {
                        JOB_CANCELLED
                    } else {
                        crate::error::INPUT_INVALID
                    }))
                })
            });
            let queue = queue(test, vec![handler.clone()]).await;
            let id = queue.submit(&test.db, input("test.one")).await.unwrap();
            let job = claim(&queue, id).await;
            run_job(
                queue.clone(),
                handler,
                Arc::new(Permission(true)),
                job,
                10,
                CancellationToken::new(),
            )
            .await
            .unwrap();
            let row = queue.get(id).await.unwrap();
            assert_eq!(row.status, status);
            assert_eq!(
                row.result,
                (status == JobStatus::Failed).then(|| json!({"errors":["invalid"]}))
            );
        }
    })
    .await;
}

#[tokio::test]
async fn cancellation_reaches_a_local_handler_holding_a_write_transaction() {
    test_support::run(async |test| {
        let entered = Arc::new(tokio::sync::Notify::new());
        let signal = entered.clone();
        let handler = handler("test.one", false, move |context| {
            let signal = signal.clone();
            Box::pin(async move {
                let tx = context.db.begin().await?;
                context
                    .progress_in_transaction(0, 1, "jobs.progress.test", Default::default())
                    .await?;
                signal.notify_one();
                context.cancellation.cancelled().await;
                tx.rollback().await?;
                Err(AppError::new(JOB_CANCELLED))
            })
        });
        let queue = queue(test, vec![handler.clone()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(
                async {
                    run_job(
                        queue.clone(),
                        handler,
                        Arc::new(Permission(true)),
                        job,
                        10,
                        CancellationToken::new(),
                    )
                    .await
                    .unwrap();
                },
                async {
                    entered.notified().await;
                    queue.cancel(id).await.unwrap();
                }
            );
        })
        .await
        .unwrap();
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Cancelled);
    })
    .await;
}

#[tokio::test]
async fn global_and_kind_limits_skip_saturated_kinds() {
    test_support::run(async |test| {
        let gate = Arc::new(tokio::sync::Semaphore::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let counts = Arc::new(Mutex::new(BTreeMap::new()));
        let mut handlers: Vec<Arc<dyn JobHandler>> = vec![];
        for (kind, limit) in [("test.a", 1), ("test.b", 2)] {
            let (gate, active, maximum, counts) = (
                gate.clone(),
                active.clone(),
                maximum.clone(),
                counts.clone(),
            );
            let mut handler = handler(kind, true, move |_| {
                let (gate, active, maximum, counts) = (
                    gate.clone(),
                    active.clone(),
                    maximum.clone(),
                    counts.clone(),
                );
                Box::pin(async move {
                    let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(count, Ordering::SeqCst);
                    *counts.lock().unwrap().entry(kind).or_insert(0) += 1;
                    gate.acquire().await.unwrap().forget();
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(json!(null))
                })
            });
            Arc::get_mut(&mut handler).unwrap().concurrency = limit;
            handlers.push(handler);
        }
        let queue = queue(test, handlers).await;
        let mut ids = Vec::new();
        for kind in ["test.a", "test.a", "test.a", "test.b", "test.b", "test.b"] {
            ids.push(queue.submit(&test.db, input(kind)).await.unwrap());
        }
        let runner = JobRunner::start(
            queue.clone(),
            Arc::new(Permission(true)),
            JobsConfig::new(3, 10).unwrap(),
            crate::maintenance::OperationGate::default(),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while active.load(Ordering::SeqCst) < 3 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(counts.lock().unwrap().get("test.a"), Some(&1));
        assert_eq!(counts.lock().unwrap().get("test.b"), Some(&2));
        gate.add_permits(6);
        for id in ids {
            wait(&queue, id, JobStatus::Succeeded).await;
        }
        runner.stop().await.unwrap();
        assert_eq!(maximum.load(Ordering::SeqCst), 3);
    })
    .await;
}

#[tokio::test]
async fn queued_and_running_cancellation_do_not_report_success() {
    test_support::run(async |test| {
        let queue = queue(
            test,
            vec![handler("test.one", true, |context| {
                Box::pin(async move {
                    context.cancellation.cancelled().await;
                    Ok(json!("completed after cancel"))
                })
            })],
        )
        .await;
        let queued = queue.submit(&test.db, input("test.one")).await.unwrap();
        assert!(queue.cancel(queued).await.unwrap());
        assert_eq!(
            queue.get(queued).await.unwrap().status,
            JobStatus::Cancelled
        );
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let runner = JobRunner::start(
            queue.clone(),
            Arc::new(Permission(true)),
            JobsConfig::new(1, 10).unwrap(),
            crate::maintenance::OperationGate::default(),
        )
        .await
        .unwrap();
        wait(&queue, id, JobStatus::Running).await;
        queue.cancel(id).await.unwrap();
        let ended = wait(&queue, id, JobStatus::Cancelled).await;
        assert!(ended.result.is_none());
        runner.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn retries_backoff_limit_unsafe_failure_and_permission_denial() {
    test_support::run(async |test| {
        let safe = handler("test.one", true, |_| {
            Box::pin(async { Err(AppError::new(INTERNAL_UNEXPECTED)) })
        });
        let unsafe_handler = handler("test.unsafe", false, |_| {
            Box::pin(async {
                Err(AppError::new(crate::error::INPUT_INVALID).with_param("path", "payload"))
            })
        });
        let queue = queue(test, vec![safe.clone(), unsafe_handler.clone()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        for attempt in 1..=3 {
            if attempt > 1 {
                assert!(
                    queue
                        .claim(id, "owner", Timestamp::now(), 10)
                        .await
                        .unwrap()
                        .is_none()
                );
                test.db
                    .execute(
                        &store::update(id)
                            .value("run_after", Timestamp::now())
                            .to_owned(),
                    )
                    .await
                    .unwrap();
            }
            let job = claim(&queue, id).await;
            let before = Timestamp::now();
            run_job(
                queue.clone(),
                safe.clone(),
                Arc::new(Permission(true)),
                job,
                10,
                CancellationToken::new(),
            )
            .await
            .unwrap();
            let row = queue.get(id).await.unwrap();
            assert_eq!(row.attempts, attempt);
            assert!(row.result.is_none());
            assert_eq!(row.error_code.as_deref(), Some("app.internal.unexpected"));
            if attempt < 3 {
                assert_eq!(row.status, JobStatus::Queued);
                assert!(row.finished_at.is_none());
                assert!(row.run_after.as_millis() >= before.as_millis() + backoff(attempt));
            } else {
                assert_eq!(row.status, JobStatus::Failed);
                assert!(row.finished_at.is_some());
            }
        }
        assert_eq!(backoff(20), 300_000);
        let id = queue.submit(&test.db, input("test.unsafe")).await.unwrap();
        let job = claim(&queue, id).await;
        run_job(
            queue.clone(),
            unsafe_handler,
            Arc::new(Permission(true)),
            job,
            10,
            CancellationToken::new(),
        )
        .await
        .unwrap();
        let row = queue.get(id).await.unwrap();
        assert_eq!(row.status, JobStatus::Failed);
        assert_eq!(row.error_params["path"], "payload");
        let mut data = input("test.one");
        data.submitted_by = Some(Id::new());
        let id = queue.submit(&test.db, data).await.unwrap();
        let job = claim(&queue, id).await;
        run_job(
            queue.clone(),
            safe,
            Arc::new(Permission(false)),
            job,
            10,
            CancellationToken::new(),
        )
        .await
        .unwrap();
        let row = queue.get(id).await.unwrap();
        assert_eq!(row.status, JobStatus::Failed);
        assert_eq!(row.error_code.as_deref(), Some("app.permission.denied"));
    })
    .await;
}

#[tokio::test]
async fn success_and_cancellation_clear_previous_attempt_errors() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        for cancelled in [false, true] {
            let id = queue.submit(&test.db, input("test.one")).await.unwrap();
            let job = claim(&queue, id).await;
            finish(
                &queue,
                &job,
                false,
                &Err(AppError::new(crate::error::INPUT_INVALID).with_param("path", "payload")),
                None,
            )
            .await
            .unwrap();
            let queued = queue.get(id).await.unwrap();
            assert_eq!(queued.status, JobStatus::Queued);
            assert_eq!(queued.error_params["path"], "payload");
            let job = queue
                .claim(id, "owner", queued.run_after, 10)
                .await
                .unwrap()
                .unwrap();
            finish(&queue, &job, cancelled, &Ok(json!({"ok": true})), None)
                .await
                .unwrap();
            let ended = queue.get(id).await.unwrap();
            assert_eq!(
                ended.status,
                if cancelled {
                    JobStatus::Cancelled
                } else {
                    JobStatus::Succeeded
                }
            );
            assert_eq!(ended.result, (!cancelled).then(|| json!({"ok": true})));
            assert!(ended.error_code.is_none());
            assert!(ended.error_params.is_empty());
            assert!(ended.finished_at.is_some());
        }
    })
    .await;
}

#[tokio::test]
async fn multiple_permissions_are_rechecked_for_the_submitter_after_submission() {
    struct Permissions {
        granted: Mutex<Vec<&'static str>>,
        checked: Mutex<Vec<(Actor, String)>>,
    }
    impl PermissionLookup for Permissions {
        fn has_permission<'a>(
            &'a self,
            actor: Actor,
            key: &'a str,
        ) -> Pin<Box<dyn Future<Output = Result<bool, AppError>> + Send + 'a>> {
            Box::pin(async move {
                self.checked.lock().unwrap().push((actor, key.into()));
                Ok(self.granted.lock().unwrap().contains(&key))
            })
        }
    }
    test_support::run(async |test| {
        for revoked in [Some("test.job.run"), Some("test.job.write"), None] {
            let calls = Arc::new(AtomicUsize::new(0));
            let executed = calls.clone();
            let handler = handler("test.one", true, move |_| {
                executed.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { Ok(Value::Null) })
            });
            let permissions = Arc::new(Permissions {
                granted: Mutex::new(handler.permissions().to_vec()),
                checked: Mutex::new(Vec::new()),
            });
            let queue = queue(test, vec![handler.clone()]).await;
            let submitter = Id::new();
            let mut submission = input("test.one");
            submission.submitted_by = Some(submitter);
            let id = queue.submit(&test.db, submission).await.unwrap();
            if let Some(key) = revoked {
                permissions
                    .granted
                    .lock()
                    .unwrap()
                    .retain(|granted| *granted != key);
            }
            let job = claim(&queue, id).await;
            run_job(
                queue.clone(),
                handler,
                permissions.clone(),
                job,
                10,
                CancellationToken::new(),
            )
            .await
            .unwrap();
            let job = queue.get(id).await.unwrap();
            assert_eq!(job.attempts, 1);
            if let Some(key) = revoked {
                assert_eq!(job.status, JobStatus::Failed);
                assert_eq!(job.error_code.as_deref(), Some("app.permission.denied"));
                assert_eq!(
                    job.error_params,
                    BTreeMap::from([("permission".into(), key.into())])
                );
                assert_eq!(calls.load(Ordering::SeqCst), 0);
            } else {
                assert_eq!(job.status, JobStatus::Succeeded);
                assert_eq!(calls.load(Ordering::SeqCst), 1);
            }
            let checked = if revoked == Some("test.job.run") {
                vec!["test.job.run"]
            } else {
                vec!["test.job.run", "test.job.write"]
            };
            assert_eq!(
                *permissions.checked.lock().unwrap(),
                checked
                    .into_iter()
                    .map(|key| (Actor::User(submitter), key.into()))
                    .collect::<Vec<_>>()
            );
        }
    })
    .await;
}

#[tokio::test]
async fn forced_shutdown_drops_handler_resources_before_finalizing() {
    test_support::run(async |test| {
        let entered = Arc::new(tokio::sync::Notify::new());
        let signal = entered.clone();
        let handler = handler("test.one", true, move |context| {
            let signal = signal.clone();
            Box::pin(async move {
                let tx = context.db.begin().await?;
                signal.notify_one();
                context.cancellation.cancelled().await;
                tx.commit().await?;
                Ok(json!(null))
            })
        });
        let queue = queue(test, vec![handler.clone()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        let force = CancellationToken::new();
        let (result, ()) = tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(
                run_job(
                    queue.clone(),
                    handler,
                    Arc::new(Permission(true)),
                    job,
                    10,
                    force.clone()
                ),
                async {
                    entered.notified().await;
                    force.cancel();
                }
            )
        })
        .await
        .unwrap();
        result.unwrap();
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Cancelled);
    })
    .await;
}
