use super::*;

fn poison<T>(mutex: &Mutex<T>) {
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = mutex.lock().unwrap();
            panic!("poison lock for regression test");
        }))
        .is_err()
    );
}

#[tokio::test]
async fn invalid_persistent_jobs_are_rejected_before_use() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        for (column, value) in [
            ("status", "invalid"),
            ("status", "failed"),
            ("status", "running"),
            ("kind", "invalid"),
            ("module", "other"),
            ("payload", "{invalid"),
        ] {
            let id = queue.submit(&test.db, input("test.one")).await.unwrap();
            test.db
                .execute(&store::update(id).value(column, value).to_owned())
                .await
                .unwrap();
            assert_eq!(
                queue.get(id).await.unwrap_err().code(),
                INVALID_STATE,
                "{column}"
            );
            assert_eq!(
                queue.cancel(id).await.unwrap_err().code(),
                INVALID_STATE,
                "{column}"
            );
            assert_eq!(
                queue
                    .list(
                        crate::db::PageRequest {
                            page: 1,
                            page_size: 100
                        },
                        None,
                        None
                    )
                    .await
                    .unwrap_err()
                    .code(),
                INVALID_STATE
            );
            test.db
                .execute(
                    &Query::delete()
                        .from_table("fw_job")
                        .and_where(Expr::col("id").eq(id))
                        .to_owned(),
                )
                .await
                .unwrap();
        }
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        claim(&queue, id).await;
        test.db
            .execute(
                &store::update(id)
                    .value("started_at", Option::<i64>::None)
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(queue.get(id).await.unwrap_err().code(), INVALID_STATE);
        test.db
            .execute(
                &store::update(id)
                    .value("started_at", Timestamp::now())
                    .value("attempts", -1)
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(queue.get(id).await.unwrap_err().code(), INVALID_STATE);
    })
    .await;
}

#[tokio::test]
async fn failed_job_without_code_cannot_start_watch() {
    struct Sink;
    impl crate::stream::StreamSink<JobEvent> for Sink {
        fn send(&self, _: crate::stream::StreamEvent<JobEvent>) -> Result<(), AppError> {
            Ok(())
        }
    }
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        test.db
            .execute(&store::update(id).value("status", "failed").to_owned())
            .await
            .unwrap();
        let stream = crate::stream::StreamRegistry::default()
            .open(
                crate::stream::StreamOwner {
                    actor: Actor::System,
                    scope: "test".into(),
                },
                Sink,
            )
            .unwrap();
        assert_eq!(
            watch(&queue, id, &stream, || async { Ok(()) })
                .await
                .unwrap_err()
                .code(),
            INVALID_STATE
        );
    })
    .await;
}

#[tokio::test]
async fn poisoned_failure_result_is_not_committed_as_success() {
    test_support::run(async |test| {
        let handler = handler("test.one", false, |context| {
            Box::pin(async move {
                poison(&context.failure_result);
                Ok(json!("uncommitted"))
            })
        });
        let queue = queue(test, vec![handler.clone()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        assert_eq!(
            run_job(
                queue.clone(),
                handler,
                Arc::new(Permission(true)),
                job,
                10,
                CancellationToken::new()
            )
            .await
            .unwrap_err()
            .code(),
            INTERNAL_UNEXPECTED
        );
        let job = queue.get(id).await.unwrap();
        assert_eq!(job.status, JobStatus::Running);
        assert!(job.result.is_none());
        assert!(queue.0.running.lock().unwrap().is_empty());
    })
    .await;
}

#[tokio::test]
async fn poisoned_job_locks_return_errors_and_destructors_do_not_panic() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let context = queue
            .test_context(id, CancellationToken::new())
            .await
            .unwrap();
        poison(&context.failure_result);
        assert_eq!(
            context.set_failure_result(json!(null)).unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        let running = RunningJob::new(queue.clone(), id, CancellationToken::new()).unwrap();
        poison(&queue.0.running);
        assert_eq!(
            queue.cancel(id).await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            RunningJob::new(queue.clone(), id, CancellationToken::new())
                .err()
                .unwrap()
                .code(),
            INTERNAL_UNEXPECTED
        );
        drop(running);
        let runner = JobRunner::start(
            queue,
            Arc::new(Permission(true)),
            JobsConfig::new(1, 10).unwrap(),
            crate::maintenance::OperationGate::default(),
        )
        .await
        .unwrap();
        let stop = runner.stop.clone();
        poison(&runner.handle);
        assert_eq!(runner.stop().await.unwrap_err().code(), INTERNAL_UNEXPECTED);
        drop(runner);
        assert!(stop.is_cancelled());
    })
    .await;
}
