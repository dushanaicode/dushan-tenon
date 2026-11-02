use super::*;

#[tokio::test]
async fn notification_write_failure_rolls_back_job_and_notification_rows() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _) = setup(test).await;
        let job = prepare(
            test,
            &queue,
            Some(user_id(&context).unwrap()),
            JobStatus::Succeeded,
        )
        .await;
        test.raw("ALTER TABLE notify_notification_delivery RENAME TO notify_delivery_unavailable")
            .await;
        let mut tx = test.db.begin().await.unwrap();
        tx.execute(
            &Query::update()
                .table("fw_job")
                .value("status", "succeeded")
                .and_where(Expr::col("id").eq(job.id))
                .to_owned(),
        )
        .await
        .unwrap();
        assert!(
            NotificationHook(service.clone())
                .complete(&mut tx, &queue, &job)
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
        test.raw("ALTER TABLE notify_delivery_unavailable RENAME TO notify_notification_delivery")
            .await;
        assert_eq!(queue.get(job.id).await.unwrap().status, JobStatus::Queued);
        assert!(
            test.rows::<(Id,)>("notify_notification", &["id"])
                .await
                .is_empty()
        );
        assert!(deliveries(test).await.is_empty());
        assert!(notifier.calls.lock().unwrap().is_empty());
    })
    .await;
}

#[tokio::test]
async fn completion_retry_does_not_rerun_the_finished_handler() {
    use std::time::Duration;
    use tenon_framework::job::{JobRunner, JobsConfig};

    struct FailOnce(AtomicUsize);
    impl JobCompletionHook for FailOnce {
        fn complete<'a>(
            &'a self,
            _: &'a mut Tx<'_>,
            _: &'a JobQueue,
            _: &'a JobSnapshot,
        ) -> JobCompletionFuture<'a> {
            Box::pin(async move {
                if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err(AppError::new(INTERNAL_UNEXPECTED))
                } else {
                    Ok(None)
                }
            })
        }
    }

    test_support::run(async |test| {
        let notifier = Arc::new(Notifier::default());
        let jobs = Arc::new(crate::test_support::TestJobs::default());
        let (service, _, context) = setup_with(
            test,
            Arc::new(Gate::default()),
            notifier.clone(),
            |_| Arc::new(Text),
            jobs.clone(),
        )
        .await;
        let failure = Arc::new(FailOnce(AtomicUsize::new(0)));
        let queue = JobQueue::new(
            test.db.clone(),
            vec![jobs.clone()],
            vec![],
            vec![Arc::new(NotificationHook(service.clone())), failure.clone()],
            tenon_framework::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
        )
        .unwrap();
        let job = prepare(
            test,
            &queue,
            Some(user_id(&context).unwrap()),
            JobStatus::Succeeded,
        )
        .await;
        let runner = JobRunner::start(
            queue.clone(),
            service.account.clone(),
            JobsConfig::new(1, 10).unwrap(),
            tenon_framework::maintenance::OperationGate::default(),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(15), async {
            while queue.get(job.id).await.unwrap().status != JobStatus::Succeeded
                || notifier.calls.lock().unwrap().is_empty()
            {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        runner.stop().await.unwrap();
        assert_eq!(jobs.0.load(Ordering::SeqCst), 1);
        assert_eq!(failure.0.load(Ordering::SeqCst), 2);
        assert_eq!(notifier.calls.lock().unwrap().len(), 1);
        assert_eq!(
            test.rows::<(Id,)>("notify_notification", &["id"])
                .await
                .len(),
            1
        );
        assert_eq!(deliveries(test).await.len(), 2);
    })
    .await;
}

#[tokio::test]
async fn expired_job_uses_the_registered_completion_hook() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _gate) = setup(test).await;
        let job = prepare(
            test,
            &queue,
            Some(user_id(&context).unwrap()),
            JobStatus::Succeeded,
        )
        .await;
        let _context = queue
            .test_context(job.id, tenon_framework::job::CancellationToken::new())
            .await
            .unwrap();
        test.db
            .execute(
                &Query::update()
                    .table("fw_job")
                    .value("retry_safe", false)
                    .value("lease_expires_at", 0_i64)
                    .and_where(Expr::col("id").eq(job.id))
                    .to_owned(),
            )
            .await
            .unwrap();
        queue.reconcile(Timestamp::now()).await.unwrap();
        queue.reconcile(Timestamp::now()).await.unwrap();
        assert_eq!(
            queue.get(job.id).await.unwrap().status,
            JobStatus::NeedsReview
        );
        let notifications = service
            .notification_list(&context, input(1, 20, false))
            .await
            .unwrap();
        assert_eq!(notifications.total, 1);
        assert_eq!(
            notifications.items[0].title_key,
            "notify.job.needs_review.title"
        );
        assert_eq!(notifier.calls.lock().unwrap().len(), 1);
        assert!(
            deliveries(test)
                .await
                .iter()
                .all(|(_, status, _)| status == "delivered")
        );
    })
    .await;
}

#[tokio::test]
async fn completion_is_atomic_and_notifies_only_user_terminal_outcomes() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _gate) = setup(test).await;
        let user = user_id(&context).unwrap();
        let rolled_back = prepare(test, &queue, Some(user), JobStatus::Succeeded).await;
        complete(test, &service, &queue, &rolled_back, false).await;
        assert_eq!(
            queue.get(rolled_back.id).await.unwrap().status,
            JobStatus::Queued
        );
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            0
        );
        assert!(deliveries(test).await.is_empty());
        assert!(notifier.calls.lock().unwrap().is_empty());
        for status in [
            JobStatus::Succeeded,
            JobStatus::Failed,
            JobStatus::NeedsReview,
        ] {
            let job = prepare(test, &queue, Some(user), status).await;
            let after = complete(test, &service, &queue, &job, true).await.unwrap();
            let page = service
                .notification_list(&context, input(1, 20, false))
                .await
                .unwrap();
            let notification = &page.items[0];
            assert_eq!(
                notification.title_key,
                format!("notify.job.{}.title", status.as_str())
            );
            assert_eq!(
                notification.params["kind"],
                json!({"$t":"jobs.kinds.notifytest.done"})
            );
            assert_eq!(notification.job_id, Some(job.id));
            if status == JobStatus::Failed {
                assert_eq!(
                    notification.params["error"],
                    json!({"$t":"errors.app.permission.denied"})
                );
                assert_eq!(notification.params["permission"], "notifytest.job.manage");
            }
            // 回调尚未执行时保留 unknown；站内消息已提交。
            assert!(
                deliveries(test)
                    .await
                    .iter()
                    .any(|(channel, status, _)| channel == "desktop" && status == "unknown")
            );
            after.await.unwrap();
        }
        for (recipient, status) in [
            (None, JobStatus::Succeeded),
            (None, JobStatus::Failed),
            (None, JobStatus::NeedsReview),
            (Some(user), JobStatus::Cancelled),
        ] {
            let job = prepare(test, &queue, recipient, status).await;
            assert!(complete(test, &service, &queue, &job, true).await.is_none());
        }
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            3
        );
        assert_eq!(deliveries(test).await.len(), 6);
        assert!(
            deliveries(test)
                .await
                .iter()
                .all(|(_, status, code)| status == "delivered" && code.is_none())
        );
        assert_eq!(
            *notifier.calls.lock().unwrap(),
            [
                ("Completed".into(), "Cleanup completed".into()),
                (
                    "Failed".into(),
                    "Cleanup: Denied notifytest.job.manage".into()
                ),
                ("Review".into(), "Review Cleanup".into())
            ]
        );
    })
    .await;
}
