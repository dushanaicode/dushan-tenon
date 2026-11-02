use super::*;
use crate::instance::InstanceId;

fn local(kind: &'static str, safe: bool) -> Arc<Handler> {
    let mut handler = handler(kind, safe, |_| {
        Box::pin(async { Err(AppError::new(crate::error::INPUT_INVALID)) })
    });
    Arc::get_mut(&mut handler).unwrap().local_only = true;
    handler
}

fn other_queue(test: &TestDb, handlers: Vec<Arc<dyn JobHandler>>) -> JobQueue {
    let root = test.root.path().join("other-instance");
    std::fs::create_dir(&root).unwrap();
    JobQueue::new(
        test.db.clone(),
        handlers,
        vec![],
        vec![],
        InstanceId::load_or_create(&root).unwrap(),
    )
    .unwrap()
}

async fn ownership(queue: &JobQueue, id: Id) -> Option<String> {
    queue
        .0
        .db
        .fetch_optional::<(Option<String>,)>(
            &Query::select()
                .column("instance_id")
                .from("fw_job")
                .and_where(Expr::col("id").eq(id))
                .to_owned(),
        )
        .await
        .unwrap()
        .unwrap()
        .0
}

#[tokio::test]
async fn local_jobs_are_owned_and_shared_jobs_can_be_claimed_by_either_instance() {
    test_support::run(async |test| {
        let local = local("test.local", true);
        let first = queue(test, vec![local.clone(), success()]).await;
        let second = other_queue(test, vec![local, success()]);
        let id = first.submit(&test.db, input("test.local")).await.unwrap();
        let mut tx = test.db.begin().await.unwrap();
        let local_tx = first.submit(&mut tx, input("test.local")).await.unwrap();
        tx.commit().await.unwrap();
        for id in [id, local_tx] {
            assert_eq!(
                ownership(&first, id).await,
                Some(first.0.instance_id.to_string())
            );
            assert!(
                second
                    .claim(id, "other", Timestamp::now(), 10)
                    .await
                    .unwrap()
                    .is_none()
            );
        }
        assert!(
            second
                .candidates(Timestamp::now())
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(first.candidates(Timestamp::now()).await.unwrap().len(), 2);
        assert_eq!(claim(&first, id).await.snapshot.id, id);
        assert!(
            !serde_json::to_value(first.get(id).await.unwrap())
                .unwrap()
                .as_object()
                .unwrap()
                .contains_key("instanceId")
        );

        let shared = first.submit(&test.db, input("test.one")).await.unwrap();
        assert_eq!(ownership(&first, shared).await, None);
        for queue in [&first, &second] {
            assert!(
                queue
                    .candidates(Timestamp::now())
                    .await
                    .unwrap()
                    .iter()
                    .any(|job| job.id == shared)
            );
        }
        assert_eq!(claim(&second, shared).await.snapshot.id, shared);
        assert!(
            first
                .claim(shared, "first", Timestamp::now(), 10)
                .await
                .unwrap()
                .is_none()
        );
        let shared = second.submit(&test.db, input("test.one")).await.unwrap();
        assert_eq!(ownership(&second, shared).await, None);
        assert_eq!(claim(&first, shared).await.snapshot.id, shared);
    })
    .await;
}

#[tokio::test]
async fn local_jobs_keep_their_instance_on_manual_and_automatic_retry() {
    test_support::run(async |test| {
        let handler = local("test.local", true);
        let first = queue(test, vec![handler.clone()]).await;
        let second = other_queue(test, vec![handler.clone()]);
        let id = first.submit(&test.db, input("test.local")).await.unwrap();
        assert!(second.cancel(id).await.unwrap());
        assert!(second.retry(id).await.unwrap());
        assert_eq!(
            ownership(&first, id).await,
            Some(first.0.instance_id.to_string())
        );
        assert!(
            second
                .candidates(Timestamp::now())
                .await
                .unwrap()
                .is_empty()
        );
        let restarted = JobQueue::new(
            test.db.clone(),
            vec![handler.clone()],
            vec![],
            vec![],
            InstanceId::load_or_create(test.root.path()).unwrap(),
        )
        .unwrap();
        let job = claim(&restarted, id).await;
        run_job(
            restarted.clone(),
            handler,
            Arc::new(Permission(true)),
            job,
            10,
            CancellationToken::new(),
        )
        .await
        .unwrap();
        let job = restarted.get(id).await.unwrap();
        assert_eq!(job.status, JobStatus::Queued);
        assert_eq!(
            ownership(&restarted, id).await,
            Some(first.0.instance_id.to_string())
        );
        assert!(second.candidates(job.run_after).await.unwrap().is_empty());
        assert!(
            second
                .claim(id, "other", job.run_after, 10)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            restarted
                .claim(id, "restarted", job.run_after, 10)
                .await
                .unwrap()
                .is_some()
        );
    })
    .await;
}

#[tokio::test]
async fn any_instance_reconciles_local_leases_without_changing_ownership() {
    test_support::run(async |test| {
        let first = queue(
            test,
            vec![local("test.safe", true), local("test.unsafe", false)],
        )
        .await;
        // 核对需要本机具备对应处理器，不要求任务属于本实例，也不执行处理器。
        let second = other_queue(
            test,
            first
                .0
                .handlers
                .values()
                .map(|item| item.handler.clone())
                .collect(),
        );
        for (kind, status) in [
            ("test.safe", JobStatus::Queued),
            ("test.unsafe", JobStatus::NeedsReview),
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
            second.reconcile(Timestamp::now()).await.unwrap();
            assert_eq!(second.get(id).await.unwrap().status, status);
            assert_eq!(
                ownership(&second, id).await,
                Some(first.0.instance_id.to_string())
            );
            if status == JobStatus::Queued {
                assert!(
                    second
                        .candidates(Timestamp::now())
                        .await
                        .unwrap()
                        .is_empty()
                );
                assert!(
                    second
                        .claim(id, "other", Timestamp::now(), 10)
                        .await
                        .unwrap()
                        .is_none()
                );
                assert_eq!(claim(&first, id).await.snapshot.id, id);
            }
        }
    })
    .await;
}

#[tokio::test]
async fn instance_migration_keeps_existing_jobs_shared_and_explicit_reads_valid() {
    test_support::run(async |test| {
        test.upgrade(&crate::migrations::MIGRATIONS[..2], 1)
            .await
            .unwrap();
        let id = Id::new();
        test.db
            .execute(
                &Query::insert()
                    .into_table("fw_job")
                    .columns([
                        "id",
                        "kind",
                        "module",
                        "payload",
                        "status",
                        "run_after",
                        "created_at",
                        "updated_at",
                        "priority",
                        "attempts",
                        "max_attempts",
                        "retry_safe",
                        "cancel_requested",
                        "row_version",
                    ])
                    .values_panic([
                        id.into(),
                        "test.one".into(),
                        "test".into(),
                        "{}".into(),
                        "queued".into(),
                        0_i64.into(),
                        0_i64.into(),
                        0_i64.into(),
                        0.into(),
                        0.into(),
                        3.into(),
                        true.into(),
                        false.into(),
                        1_i64.into(),
                    ])
                    .to_owned(),
            )
            .await
            .unwrap();
        // 先缓存迁移前的查询，再添加可空列。
        let first = JobQueue::new(
            test.db.clone(),
            vec![success()],
            vec![],
            vec![],
            InstanceId::load_or_create(test.root.path()).unwrap(),
        )
        .unwrap();
        assert_eq!(first.get(id).await.unwrap().id, id);
        test.upgrade(crate::migrations::MIGRATIONS, 1)
            .await
            .unwrap();
        assert_eq!(first.get(id).await.unwrap().id, id);
        assert_eq!(ownership(&first, id).await, None);
        let other = other_queue(test, vec![success()]);
        assert_eq!(claim(&other, id).await.snapshot.id, id);
    })
    .await;
}
