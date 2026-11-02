use super::*;

#[tokio::test]
async fn pagination_unread_and_read_updates_are_scoped_to_the_actor() {
    test_support::run(async |test| {
        let (service, queue, context, _, _gate) = setup(test).await;
        let user = user_id(&context).unwrap();
        let other = Id::new();
        for recipient in [user, user, user, other] {
            let job = prepare(test, &queue, Some(recipient), JobStatus::Succeeded).await;
            drop(complete(test, &service, &queue, &job, true).await);
        }
        let other_context = ExecutionContext::new(Actor::User(other), "other");
        let other_id = service
            .notification_list(&other_context, input(1, 20, false))
            .await
            .unwrap()
            .items[0]
            .id;
        let first = service
            .notification_list(&context, input(1, 2, false))
            .await
            .unwrap();
        let second = service
            .notification_list(&context, input(2, 2, false))
            .await
            .unwrap();
        assert_eq!(
            (first.total, first.items.len(), second.items.len()),
            (3, 2, 1)
        );
        assert!(first.items[0].id > first.items[1].id && first.items[1].id > second.items[0].id);
        service
            .notification_mark_read(
                &context,
                NotificationReadInput {
                    ids: vec![first.items[0].id, other_id],
                },
            )
            .await
            .unwrap();
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            2
        );
        assert_eq!(
            service
                .notification_unread_count(&other_context)
                .await
                .unwrap(),
            1
        );
        let unread = service
            .notification_list(&context, input(1, 20, true))
            .await
            .unwrap();
        assert_eq!(unread.total, 2);
        assert!(unread.items.iter().all(|item| item.read_at.is_none()));
        service.notification_mark_all_read(&context).await.unwrap();
        assert_eq!(
            service.notification_unread_count(&context).await.unwrap(),
            0
        );
        assert_eq!(
            service
                .notification_unread_count(&other_context)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            service
                .notification_list(&context, input(1, 20, false))
                .await
                .unwrap()
                .total,
            3
        );
        assert!(
            service
                .notification_list(&context, input(0, 20, false))
                .await
                .is_err()
        );
        assert!(
            service
                .notification_mark_read(&context, NotificationReadInput { ids: vec![] })
                .await
                .is_err()
        );
    })
    .await;
}

#[tokio::test]
async fn job_notifications_store_job_id_and_never_persist_devtools_paths() {
    test_support::run(async |test| {
        let (service, queue, context, _, _gate) = setup(test).await;
        let job = prepare(
            test,
            &queue,
            Some(user_id(&context).unwrap()),
            JobStatus::Succeeded,
        )
        .await;
        drop(complete(test, &service, &queue, &job, true).await);
        let page = service
            .notification_list(&context, input(1, 20, false))
            .await
            .unwrap();
        assert_eq!(page.items[0].job_id, Some(job.id));
        let value = serde_json::to_value(&page.items[0]).unwrap();
        assert_eq!(value["jobId"], job.id.to_string());
        assert!(value.get("link").is_none());
        assert!(!value.to_string().contains("/devtools/"));
        assert_eq!(
            test.rows::<(Id,)>("notify_notification", &["job_id"]).await,
            [(job.id,)]
        );
    })
    .await;
}
