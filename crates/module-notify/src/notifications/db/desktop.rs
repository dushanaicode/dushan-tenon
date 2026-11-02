use super::*;

#[tokio::test]
async fn after_commit_desktop_failure_preserves_in_app_and_job_success_without_resend() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _) = setup(test).await;
        notifier.fail.store(true, Ordering::SeqCst);
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
            queue.get(job.id).await.unwrap().status,
            JobStatus::Succeeded
        );
        let records = deliveries(test).await;
        assert!(records.contains(&(
            "desktop".into(),
            "unknown".into(),
            Some(crate::DESKTOP_FAILED.as_str().into())
        )));
        assert!(records.contains(&("in_app".into(), "delivered".into(), None)));
        assert!(!format!("{records:?}").contains("private transport detail"));
        queue.reconcile(Timestamp::now()).await.unwrap();
        assert_eq!(notifier.calls.lock().unwrap().len(), 1);
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            1
        );
    })
    .await;
}

#[tokio::test]
async fn gate_poisoning_propagates_without_sending_or_losing_in_app() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, gate) = setup(test).await;
        let poison = gate.clone();
        assert!(
            std::thread::spawn(move || {
                let _lock = poison.0.write().unwrap();
                panic!("poison test gate");
            })
            .join()
            .is_err()
        );
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
        assert!(deliveries(test).await.contains(&(
            "desktop".into(),
            "unknown".into(),
            Some(INTERNAL_UNEXPECTED.as_str().into())
        )));
        assert_eq!(
            service
                .notification_test_send(&context)
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        assert!(notifier.calls.lock().unwrap().is_empty());
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            2
        );
    })
    .await;
}

#[tokio::test]
async fn desktop_results_follow_current_user_settings_and_session() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, gate) = setup(test).await;
        let user = user_id(&context).unwrap();
        for (recipient, enabled, fail, expected) in [
            (user, true, false, "delivered"),
            (user, true, true, "unknown"),
            (user, false, false, "skipped"),
            (Id::new(), true, false, "skipped"),
        ] {
            *gate.0.write().unwrap() = enabled;
            notifier.fail.store(fail, Ordering::SeqCst);
            let job = prepare(test, &queue, Some(recipient), JobStatus::Succeeded).await;
            complete(test, &service, &queue, &job, true)
                .await
                .unwrap()
                .await
                .unwrap();
            let record: (String, Option<String>) = test
                .db
                .fetch_optional(
                    &Query::select()
                        .columns(["status", "error_code"])
                        .from("notify_notification_delivery")
                        .and_where(Expr::col("channel").eq("desktop"))
                        .order_by("id", Order::Desc)
                        .to_owned(),
                )
                .await
                .unwrap()
                .unwrap();
            assert_eq!(record.0, expected);
            assert_eq!(
                record.1.as_deref(),
                fail.then_some(crate::DESKTOP_FAILED.as_str())
            );
        }
        let password = "notification-test-password".to_owned();
        service
            .account
            .enable_login(&context, password.clone())
            .await
            .unwrap();
        let active = prepare(test, &queue, Some(user), JobStatus::Succeeded).await;
        complete(test, &service, &queue, &active, true)
            .await
            .unwrap()
            .await
            .unwrap();
        service.account.lock().await.unwrap();
        let locked = prepare(test, &queue, Some(user), JobStatus::Succeeded).await;
        complete(test, &service, &queue, &locked, true)
            .await
            .unwrap()
            .await
            .unwrap();
        service.account.logout(&context).await.unwrap();
        let anonymous = prepare(test, &queue, Some(user), JobStatus::Succeeded).await;
        complete(test, &service, &queue, &anonymous, true)
            .await
            .unwrap()
            .await
            .unwrap();
        assert_eq!(notifier.calls.lock().unwrap().len(), 3);
        assert_eq!(
            deliveries(test)
                .await
                .iter()
                .filter(|(channel, status, _)| channel == "desktop" && status == "skipped")
                .count(),
            4
        );
    })
    .await;
}

#[tokio::test]
async fn delivery_result_persistence_failure_leaves_unknown_without_resend() {
    test_support::run(async |test| {
        let (service, queue, context, notifier, _gate) = setup(test).await;
        let job = prepare(
            test,
            &queue,
            Some(user_id(&context).unwrap()),
            JobStatus::Succeeded,
        )
        .await;
        let after = complete(test, &service, &queue, &job, true).await.unwrap();
        test.raw("ALTER TABLE notify_notification_delivery RENAME TO notify_delivery_unavailable")
            .await;
        let result = after.await;
        test.raw("ALTER TABLE notify_delivery_unavailable RENAME TO notify_notification_delivery")
            .await;
        assert!(result.is_err());
        assert_eq!(
            queue.get(job.id).await.unwrap().status,
            JobStatus::Succeeded
        );
        assert_eq!(notifier.calls.lock().unwrap().len(), 1);
        assert!(
            deliveries(test)
                .await
                .iter()
                .filter(|(channel, _, _)| channel != "in_app")
                .all(|(_, status, error)| status == "unknown" && error.is_none())
        );
        queue.reconcile(Timestamp::now()).await.unwrap();
        assert_eq!(notifier.calls.lock().unwrap().len(), 1);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn desktop_send_holds_account_permit_and_rechecks_configuration() {
    use std::{
        future::{Future, poll_fn},
        sync::Barrier,
        task::Poll,
    };
    struct Blocking {
        entered: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
        release: Arc<Barrier>,
        focused: bool,
    }
    impl DesktopNotifier for Blocking {
        fn window_focused(&self) -> bool {
            self.focused
        }
        fn send(&self, _: &str, _: &str) -> Result<(), AppError> {
            self.entered
                .lock()
                .unwrap()
                .take()
                .unwrap()
                .send(())
                .unwrap();
            self.release.wait();
            Ok(())
        }
    }
    test_support::run(async |test| {
        let (entered, ready) = tokio::sync::oneshot::channel();
        let release = Arc::new(Barrier::new(2));
        let gate = Arc::new(Gate::default());
        let (service, queue, context) = setup_with(
            test,
            gate.clone(),
            Arc::new(Blocking {
                entered: Mutex::new(Some(entered)),
                release: release.clone(),
                focused: false,
            }),
            |_| Arc::new(Text),
            Arc::new(crate::test_support::TestJobs::default()),
        )
        .await;
        service
            .account
            .enable_login(&context, "desktop-permit-password".into())
            .await
            .unwrap();
        let job = prepare(
            test,
            &queue,
            Some(user_id(&context).unwrap()),
            JobStatus::Succeeded,
        )
        .await;
        let after = complete(test, &service, &queue, &job, true).await.unwrap();
        let worker = std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(after)
        });
        ready.await.unwrap();
        let mut logout = Box::pin(service.account.logout(&context));
        let pending = poll_fn(|cx| Poll::Ready(logout.as_mut().poll(cx).is_pending())).await;
        let config_locked = gate.0.try_write().is_err();
        release.wait();
        tokio::task::spawn_blocking(move || worker.join())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(pending && config_locked);
        logout.await.unwrap();
        assert!(
            deliveries(test)
                .await
                .iter()
                .any(|(channel, status, _)| channel == "desktop" && status == "delivered")
        );
    })
    .await;

    struct SwitchText {
        gate: Arc<Gate>,
    }
    impl Translator for SwitchText {
        fn text_in(
            &self,
            _: tenon_framework::i18n::Language,
            key: &str,
            params: &Map<String, Value>,
        ) -> Result<String, AppError> {
            self.text(key, params)
        }
        fn text(&self, key: &str, params: &Map<String, Value>) -> Result<String, AppError> {
            *self.gate.0.write().unwrap() = false;
            Text.text(key, params)
        }
    }
    test_support::run(async |test| {
        let notifier = Arc::new(Notifier::default());
        let gate = Arc::new(Gate::default());
        let (service, queue, context) = setup_with(
            test,
            gate.clone(),
            notifier.clone(),
            |gate| Arc::new(SwitchText { gate }),
            Arc::new(crate::test_support::TestJobs::default()),
        )
        .await;
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
        assert!(notifier.calls.lock().unwrap().is_empty());
        assert!(
            deliveries(test)
                .await
                .iter()
                .any(|(channel, status, _)| channel == "desktop" && status == "skipped")
        );
        *gate.0.write().unwrap() = true;
        assert_eq!(
            service
                .notification_test_send(&context)
                .await
                .unwrap()
                .desktop,
            NotifyTestDesktop::Disabled
        );
        assert!(notifier.calls.lock().unwrap().is_empty());
    })
    .await;
}
