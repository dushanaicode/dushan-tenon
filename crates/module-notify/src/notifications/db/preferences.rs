use super::*;

#[tokio::test]
async fn preference_read_errors_rollback_writes_and_fail_desktop_delivery() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _gate) = setup(test).await;
        for (key, valid) in [
            ("notify.job_succeeded", "true"),
            ("notify.retention_days", "0"),
        ] {
            set(&service, &context, key, valid).await;
            test.db
                .execute(
                    &Query::update()
                        .table("fw_param")
                        .value("value", "invalid")
                        .and_where(Expr::col("param_key").eq(key))
                        .to_owned(),
                )
                .await
                .unwrap();
            let job = prepare(
                test,
                &queue,
                Some(user_id(&context).unwrap()),
                JobStatus::Succeeded,
            )
            .await;
            let mut tx = test.db.begin().await.unwrap();
            let error = NotificationHook(service.clone())
                .complete(&mut tx, &queue, &job)
                .await
                .err()
                .unwrap();
            assert_eq!(error.code(), INTERNAL_UNEXPECTED);
            tx.rollback().await.unwrap();
            assert!(
                test.rows::<(Id,)>("notify_notification", &["id"])
                    .await
                    .is_empty()
            );
            assert!(deliveries(test).await.is_empty());
            service
                .started()
                .unwrap()
                .params
                .reset(key, Some(1))
                .await
                .unwrap();
        }
        set(&service, &context, "notify.quiet_enabled", "true").await;
        test.db
            .execute(
                &Query::update()
                    .table("fw_param")
                    .value("value", "invalid")
                    .and_where(Expr::col("param_key").eq("notify.quiet_enabled"))
                    .to_owned(),
            )
            .await
            .unwrap();
        let job = prepare(
            test,
            &queue,
            Some(user_id(&context).unwrap()),
            JobStatus::Succeeded,
        )
        .await;
        complete(test, &service, &queue, &job, true)
            .await
            .unwrap()
            .await
            .unwrap();
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            1
        );
        assert!(notifier.calls.lock().unwrap().is_empty());
        assert!(deliveries(test).await.contains(&(
            "desktop".into(),
            "unknown".into(),
            Some(INTERNAL_UNEXPECTED.as_str().into())
        )));
    })
    .await;
}

async fn set(service: &NotifyService, context: &ExecutionContext, key: &str, value: &str) {
    let params = &service.started().unwrap().params;
    let version = params
        .entries()
        .await
        .unwrap()
        .into_iter()
        .find(|entry| entry.key == key)
        .unwrap()
        .row_version;
    params.set(context, key, value, version).await.unwrap();
}

async fn category_switch(status: JobStatus, key: &str) {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _gate) = setup(test).await;
        let user = user_id(&context).unwrap();
        set(&service, &context, key, "false").await;
        let job = prepare(test, &queue, Some(user), status).await;
        assert!(complete(test, &service, &queue, &job, true).await.is_none());
        assert!(
            test.rows::<(Id,)>("notify_notification", &["id"])
                .await
                .is_empty()
        );
        assert!(deliveries(test).await.is_empty());
        assert!(notifier.calls.lock().unwrap().is_empty());
        set(&service, &context, key, "true").await;
        let job = prepare(test, &queue, Some(user), status).await;
        complete(test, &service, &queue, &job, true)
            .await
            .unwrap()
            .await
            .unwrap();
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            1
        );
        assert_eq!(deliveries(test).await.len(), 2);
        assert!(
            deliveries(test)
                .await
                .iter()
                .all(|(_, status, _)| status == "delivered")
        );
        assert_eq!(notifier.calls.lock().unwrap().len(), 1);
    })
    .await;
}

#[tokio::test]
async fn succeeded_category_switch_controls_notification_and_deliveries() {
    category_switch(JobStatus::Succeeded, "notify.job_succeeded").await;
}

#[tokio::test]
async fn failed_category_switch_controls_notification_and_deliveries() {
    category_switch(JobStatus::Failed, "notify.job_failed").await;
}

#[tokio::test]
async fn needs_review_category_switch_controls_notification_and_deliveries() {
    category_switch(JobStatus::NeedsReview, "notify.job_needs_review").await;
}

#[tokio::test]
async fn retention_removes_only_own_expired_read_rows_and_deliveries_atomically() {
    for days in [0, 7] {
        test_support::run(async |test| {
            let (service, queue, context, _, _gate) = setup(test).await;
            set(
                &service,
                &context,
                "notify.retention_days",
                &days.to_string(),
            )
            .await;
            let user = user_id(&context).unwrap();
            let other = Id::new();
            let now = (service.clock)().as_millis();
            let cutoff = now - 7 * 86_400_000;
            let mut ids = Vec::new();
            for (recipient, read_at) in [
                (user, Some(cutoff - 1)),
                (user, Some(cutoff)),
                (user, Some(cutoff + 1)),
                (user, None),
                (other, Some(cutoff - 1)),
            ] {
                let job = prepare(test, &queue, Some(recipient), JobStatus::Succeeded).await;
                drop(complete(test, &service, &queue, &job, true).await);
                let (id,) = test
                    .db
                    .fetch_optional::<(Id,)>(
                        &Query::select()
                            .column("id")
                            .from("notify_notification")
                            .and_where(Expr::col("job_id").eq(job.id))
                            .to_owned(),
                    )
                    .await
                    .unwrap()
                    .unwrap();
                ids.push((id, read_at));
            }
            // 全部插入之后再设置已读时间，避免夹具准备时触发清理。
            for (id, read_at) in &ids {
                test.db
                    .execute(
                        &Query::update()
                            .table("notify_notification")
                            .value("read_at", *read_at)
                            .and_where(Expr::col("id").eq(*id))
                            .to_owned(),
                    )
                    .await
                    .unwrap();
            }
            let job = prepare(test, &queue, Some(user), JobStatus::Succeeded).await;
            complete(test, &service, &queue, &job, false).await;
            assert_eq!(
                test.rows::<(Id,)>("notify_notification", &["id"])
                    .await
                    .len(),
                5
            );
            assert_eq!(deliveries(test).await.len(), 10);
            drop(complete(test, &service, &queue, &job, true).await);
            let rows = test.rows::<(Id,)>("notify_notification", &["id"]).await;
            assert_eq!(rows.len(), if days == 0 { 6 } else { 5 });
            assert_eq!(rows.contains(&(ids[0].0,)), days == 0);
            for (id, _) in &ids[1..] {
                assert!(rows.contains(&(*id,)));
            }
            let delivery_ids = test
                .rows::<(Id,)>("notify_notification_delivery", &["notification_id"])
                .await;
            assert_eq!(delivery_ids.len(), rows.len() * 2);
            assert!(delivery_ids.iter().all(|id| rows.contains(id)));
        })
        .await;
    }
}

#[tokio::test]
async fn desktop_quiet_and_focus_rules_use_injected_clock_and_preserve_in_app() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _gate) = setup(test).await;
        let hour = crate::quiet::local_hour((service.clock)());
        for (quiet, start, end, focused, when_focused, expected, focus_reads) in [
            (true, hour, (hour + 1) % 24, true, false, "skipped", 0),
            (true, (hour + 23) % 24, hour, false, false, "delivered", 1),
            (true, hour, hour, false, true, "skipped", 0),
            (false, hour, hour, true, false, "skipped", 1),
            (false, hour, hour, false, false, "delivered", 1),
            (false, hour, hour, true, true, "delivered", 0),
        ] {
            let job = prepare(
                test,
                &queue,
                Some(user_id(&context).unwrap()),
                JobStatus::Succeeded,
            )
            .await;
            let after = complete(test, &service, &queue, &job, true).await.unwrap();
            // 在 stage 之后修改；参数必须在 AfterCommit 读取。
            set(
                &service,
                &context,
                "notify.quiet_enabled",
                &quiet.to_string(),
            )
            .await;
            set(
                &service,
                &context,
                "notify.quiet_start_hour",
                &start.to_string(),
            )
            .await;
            set(
                &service,
                &context,
                "notify.quiet_end_hour",
                &end.to_string(),
            )
            .await;
            set(
                &service,
                &context,
                "notify.desktop_when_focused",
                &when_focused.to_string(),
            )
            .await;
            notifier.focused.store(focused, Ordering::SeqCst);
            notifier.focus_reads.store(0, Ordering::SeqCst);
            let sent = notifier.calls.lock().unwrap().len();
            after.await.unwrap();
            assert_eq!(notifier.focus_reads.load(Ordering::SeqCst), focus_reads);
            assert_eq!(
                notifier.calls.lock().unwrap().len() - sent,
                usize::from(expected == "delivered")
            );
            let (notification,) = test
                .db
                .fetch_optional::<(Id,)>(
                    &Query::select()
                        .column("id")
                        .from("notify_notification")
                        .and_where(Expr::col("job_id").eq(job.id))
                        .to_owned(),
                )
                .await
                .unwrap()
                .unwrap();
            let rows = test
                .db
                .fetch_all::<(String, String)>(
                    &Query::select()
                        .columns(["channel", "status"])
                        .from("notify_notification_delivery")
                        .and_where(Expr::col("notification_id").eq(notification))
                        .to_owned(),
                )
                .await
                .unwrap();
            assert!(rows.contains(&("desktop".into(), expected.into())));
            assert!(rows.contains(&("in_app".into(), "delivered".into())));
        }
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            6
        );
    })
    .await;
}

#[tokio::test]
async fn test_notification_writes_in_app_and_reports_desktop_outcomes_without_preference_filters() {
    test_support::run(async |test| {
        let (service, _, context, notifier, gate) = setup(test).await;
        for key in [
            "notify.job_succeeded",
            "notify.job_failed",
            "notify.job_needs_review",
            "notify.desktop_when_focused",
        ] {
            set(&service, &context, key, "false").await;
        }
        set(&service, &context, "notify.quiet_enabled", "true").await;
        set(&service, &context, "notify.quiet_start_hour", "0").await;
        set(&service, &context, "notify.quiet_end_hour", "0").await;
        notifier.focused.store(true, Ordering::SeqCst);
        for (enabled, fail, expected, status) in [
            (true, false, NotifyTestDesktop::Sent, "delivered"),
            (false, false, NotifyTestDesktop::Disabled, "skipped"),
            (true, true, NotifyTestDesktop::Failed, "failed"),
        ] {
            *gate.0.write().unwrap() = enabled;
            notifier.fail.store(fail, Ordering::SeqCst);
            assert_eq!(
                service
                    .notification_test_send(&context)
                    .await
                    .unwrap()
                    .desktop,
                expected
            );
            let page = service
                .notification_list(&context, input(1, 20, false))
                .await
                .unwrap();
            let item = &page.items[0];
            assert_eq!(item.category, "test");
            assert_eq!(item.title_key, "notify.test.title");
            assert_eq!(item.body_key, "notify.test.body");
            assert!(item.job_id.is_none() && item.read_at.is_none() && item.params.is_empty());
            let rows = test
                .db
                .fetch_all::<(String, String, Option<String>)>(
                    &Query::select()
                        .columns(["channel", "status", "error_code"])
                        .from("notify_notification_delivery")
                        .and_where(Expr::col("notification_id").eq(item.id))
                        .to_owned(),
                )
                .await
                .unwrap();
            assert!(rows.contains(&("desktop".into(), status.into(), None)));
            assert!(rows.contains(&("in_app".into(), "delivered".into(), None)));
        }
        assert_eq!(notifier.calls.lock().unwrap().len(), 2);
        assert_eq!(notifier.focus_reads.load(Ordering::SeqCst), 0);
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            3
        );
        let other = ExecutionContext::new(Actor::User(Id::new()), "other");
        assert_eq!(
            service
                .notification_list(&other, input(1, 20, false))
                .await
                .unwrap()
                .total,
            0
        );
    })
    .await;
}
