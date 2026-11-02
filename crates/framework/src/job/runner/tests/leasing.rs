use super::*;

#[tokio::test]
async fn submission_priority_order_claim_and_transaction_rollback() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let first = queue.submit(&test.db, input("test.one")).await.unwrap();
        let second = queue.submit(&test.db, input("test.one")).await.unwrap();
        let mut high = input("test.one");
        high.priority = 10;
        let high = queue.submit(&test.db, high).await.unwrap();
        let now = Timestamp::now();
        test.db
            .execute(
                &Query::update()
                    .table("fw_job")
                    .value("created_at", now)
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(
            queue
                .candidates(now)
                .await
                .unwrap()
                .iter()
                .map(|job| job.id)
                .collect::<Vec<_>>(),
            vec![high, first, second]
        );
        let claimed = claim(&queue, high).await;
        assert_eq!(
            (claimed.snapshot.status, claimed.snapshot.attempts),
            (JobStatus::Running, 1)
        );
        assert!(queue.claim(high, "other", now, 10).await.unwrap().is_none());
        let mut tx = test.db.begin().await.unwrap();
        let rolled = queue.submit(&mut tx, input("test.one")).await.unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(
            queue.get(rolled).await.unwrap_err().code(),
            crate::error::DATA_NOT_FOUND
        );
        assert_eq!(
            queue
                .submit(&test.db, input("not.registered"))
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
    })
    .await;
}

#[tokio::test]
async fn two_instances_claim_each_job_only_once() {
    test_support::run(async |test| {
        let executions = Arc::new(Mutex::new(BTreeMap::new()));
        let records = executions.clone();
        let handler = handler("test.one", true, move |context| {
            let records = records.clone();
            Box::pin(async move {
                let index = context.payload["index"].as_u64().unwrap();
                *records.lock().unwrap().entry(index).or_insert(0) += 1;
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok(json!(index))
            })
        });
        let queue = queue(test, vec![handler]).await;
        let mut ids = Vec::new();
        for index in 0..8 {
            let mut data = input("test.one");
            data.payload = json!({"index":index});
            ids.push(queue.submit(&test.db, data).await.unwrap());
        }
        let a = JobRunner::start(
            queue.clone(),
            Arc::new(Permission(true)),
            JobsConfig::new(4, 30).unwrap(),
            crate::maintenance::OperationGate::default(),
        )
        .await
        .unwrap();
        let b = JobRunner::start(
            queue.clone(),
            Arc::new(Permission(true)),
            JobsConfig::new(4, 30).unwrap(),
            crate::maintenance::OperationGate::default(),
        )
        .await
        .unwrap();
        for id in ids {
            wait(&queue, id, JobStatus::Succeeded).await;
        }
        a.stop().await.unwrap();
        b.stop().await.unwrap();
        assert_eq!(executions.lock().unwrap().len(), 8);
        assert!(executions.lock().unwrap().values().all(|&count| count == 1));
    })
    .await;
}

#[tokio::test]
async fn heartbeat_renews_cancels_and_rejects_takeover() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        let token = CancellationToken::new();
        test.db
            .execute(
                &store::update(id)
                    .value("lease_expires_at", 0_i64)
                    .to_owned(),
            )
            .await
            .unwrap();
        assert!(heartbeat(&queue, &job, 10, &token).await.unwrap());
        let (expiry,): (i64,) = test
            .db
            .fetch_optional(
                &Query::select()
                    .column("lease_expires_at")
                    .from("fw_job")
                    .and_where(Expr::col("id").eq(id))
                    .to_owned(),
            )
            .await
            .unwrap()
            .unwrap();
        assert!(expiry > Timestamp::now().as_millis());
        queue.cancel(id).await.unwrap();
        assert!(heartbeat(&queue, &job, 10, &token).await.unwrap());
        assert!(token.is_cancelled());
        test.db
            .execute(&store::update(id).value("lease_owner", "other").to_owned())
            .await
            .unwrap();
        assert!(!heartbeat(&queue, &job, 10, &token).await.unwrap());
        finish(&queue, &job, false, &Ok(json!("old")), None)
            .await
            .unwrap();
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Running);
        assert!(queue.get(id).await.unwrap().result.is_none());
        // 即使 owner 相同，也不能越过一次新领取的 started_at 栅栏。
        test.db
            .execute(
                &store::update(id)
                    .value("lease_owner", "owner")
                    .value("started_at", job.started_at.as_millis() + 1)
                    .to_owned(),
            )
            .await
            .unwrap();
        finish(&queue, &job, false, &Ok(json!("old")), None)
            .await
            .unwrap();
        assert!(queue.get(id).await.unwrap().result.is_none());
    })
    .await;
}

#[tokio::test]
async fn restart_reconciles_expired_safe_and_unsafe_jobs() {
    test_support::run(async |test| {
        let queue = queue(
            test,
            vec![
                success(),
                handler("test.unsafe", false, |_| {
                    Box::pin(async { Ok(json!(null)) })
                }),
            ],
        )
        .await;
        let mut ids = vec![];
        for kind in ["test.one", "test.unsafe"] {
            let id = queue.submit(&test.db, input(kind)).await.unwrap();
            claim(&queue, id).await;
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
        let restarted = JobQueue::new(
            test.db.clone(),
            queue
                .0
                .handlers
                .values()
                .map(|item| item.handler.clone())
                .collect(),
            vec![],
            vec![],
            crate::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
        )
        .unwrap();
        restarted.reconcile(Timestamp::now()).await.unwrap();
        assert_eq!(queue.get(ids[0]).await.unwrap().status, JobStatus::Queued);
        assert_eq!(
            queue.get(ids[1]).await.unwrap().status,
            JobStatus::NeedsReview
        );
        let job = claim(&queue, ids[0]).await;
        test.db
            .execute(
                &store::update(job.snapshot.id)
                    .value("attempts", 3)
                    .value("lease_expires_at", 0_i64)
                    .to_owned(),
            )
            .await
            .unwrap();
        queue.reconcile(Timestamp::now()).await.unwrap();
        assert_eq!(
            queue.get(job.snapshot.id).await.unwrap().status,
            JobStatus::NeedsReview
        );
    })
    .await;
}

#[tokio::test]
async fn heartbeat_does_not_suspend_a_handler_holding_a_transaction() {
    test_support::run(async |test| {
        let handler = handler("test.one", true, |context| {
            Box::pin(async move {
                let tx = context.db.begin().await?;
                tokio::time::sleep(Duration::from_millis(3500)).await;
                tx.commit().await?;
                Ok(json!("committed"))
            })
        });
        let queue = queue(test, vec![handler.clone()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        tokio::time::timeout(
            Duration::from_secs(7),
            run_job(
                queue.clone(),
                handler,
                Arc::new(Permission(true)),
                job,
                10,
                CancellationToken::new(),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(queue.get(id).await.unwrap().status, JobStatus::Succeeded);
    })
    .await;
}
