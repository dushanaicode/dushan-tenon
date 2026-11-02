use std::future::Future;

use super::*;

#[tokio::test(flavor = "current_thread")]
async fn soft_delete_filters_reads_and_allows_business_key_reuse() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let id = insert_record(&test.db, "reusable").await;
        assert!(
            test.db
                .insert(RECORDS, &context(), [("business_key", "reusable".into())])
                .await
                .is_err()
        );
        let user = Id::new();
        test.db
            .soft_delete_by_id(
                RECORDS,
                &ExecutionContext::new(Actor::User(user), "delete"),
                id,
                Some(1),
            )
            .await
            .unwrap();
        assert!(
            test.db
                .fetch_all::<Record>(&select(RECORDS).into_query())
                .await
                .unwrap()
                .is_empty()
        );
        let row = record(&test.db, id).await;
        assert!(row.deleted_at.is_some());
        assert_eq!(row.delete_token, id.to_string());
        assert_eq!(row.row_version, 2);
        assert_eq!(row.updated_by, user.to_string());
        assert_eq!(row.created_by, "system");
        let replacement = insert_record(&test.db, "reusable").await;
        assert_ne!(id, replacement);
        assert_eq!(
            test.db
                .fetch_all::<Record>(
                    &Query::select()
                        .from(RECORDS.name)
                        .column(sea_query::Asterisk)
                        .to_owned()
                )
                .await
                .unwrap()
                .len(),
            2
        );
        let visible: Vec<Record> = test
            .db
            .fetch_all(&select(RECORDS).into_query())
            .await
            .unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, replacement);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn update_and_delete_distinguish_missing_deleted_and_stale_versions() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let id = insert_record(&test.db, "record").await;
        test.db
            .update_by_id(
                RECORDS,
                &context(),
                id,
                Some(1),
                [("business_key", "new".into())],
            )
            .await
            .unwrap();
        for (target, version, expected) in [
            (id, 1, DATA_VERSION_CONFLICT),
            (Id::new(), 1, DATA_NOT_FOUND),
        ] {
            let error = test
                .db
                .update_by_id(
                    RECORDS,
                    &context(),
                    target,
                    Some(version),
                    [("business_key", "wrong".into())],
                )
                .await
                .unwrap_err();
            assert_eq!(error.code, expected);
            let error = test
                .db
                .soft_delete_by_id(RECORDS, &context(), target, Some(version))
                .await
                .unwrap_err();
            assert_eq!(error.code, expected);
        }
        assert_eq!(record(&test.db, id).await.row_version, 2);
        test.db
            .soft_delete_by_id(RECORDS, &context(), id, Some(2))
            .await
            .unwrap();
        let error = test
            .db
            .update_by_id(
                RECORDS,
                &context(),
                id,
                Some(3),
                [("business_key", "resurrect".into())],
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, DATA_NOT_FOUND);
        let error = test
            .db
            .soft_delete_by_id(RECORDS, &context(), id, Some(3))
            .await
            .unwrap_err();
        assert_eq!(error.code, DATA_NOT_FOUND);
        assert_eq!(record(&test.db, id).await.row_version, 3);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn competing_updates_with_same_version_have_exactly_one_winner() {
    test_support::run(async |test| {
        fn assert_send<T: Future + Send>(future: T) -> T {
            future
        }
        setup(test, Schema::Records).await;
        let id = insert_record(&test.db, "initial").await;
        let context = context();
        let (first, second) = tokio::join!(
            assert_send(test.db.update_by_id(
                RECORDS,
                &context,
                id,
                Some(1),
                [("business_key", "first".into())]
            )),
            assert_send(test.db.update_by_id(
                RECORDS,
                &context,
                id,
                Some(1),
                [("business_key", "second".into())]
            )),
        );
        assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
        let error = first.err().or_else(|| second.err()).unwrap();
        assert_eq!(error.code, DATA_VERSION_CONFLICT);
        assert_eq!(record(&test.db, id).await.row_version, 2);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn missing_record_detection_uses_current_state_after_a_transaction_read() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let id = insert_record(&test.db, "snapshot").await;
        let mut tx = test.db.begin().await.unwrap();
        let existing: Vec<Record> = tx.fetch_all(&select(RECORDS).into_query()).await.unwrap();
        assert_eq!(existing.len(), 1);
        if test.db.dialect() == Dialect::Sqlite {
            tx.soft_delete_by_id(RECORDS, &context(), id, Some(1))
                .await
                .unwrap();
        } else {
            test.db
                .soft_delete_by_id(RECORDS, &context(), id, Some(1))
                .await
                .unwrap();
        }
        let error = tx
            .update_by_id(
                RECORDS,
                &context(),
                id,
                Some(1),
                [("business_key", "stale".into())],
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, DATA_NOT_FOUND);
        tx.rollback().await.unwrap();
    })
    .await;
}
