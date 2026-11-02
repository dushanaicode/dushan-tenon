use super::*;

#[tokio::test(flavor = "current_thread")]
async fn physical_deletion_by_id_and_condition_is_transactional_and_rejects_soft_tables() {
    test_support::run(async |test| {
        setup(test, Schema::PlainSoft).await;
        let plain = Table {
            name: "plain",
            audit: false,
            soft_delete: false,
            optimistic_lock: false,
        };
        let soft = Table {
            name: "soft",
            soft_delete: true,
            ..plain
        };
        let first = test
            .db
            .insert(plain, &context(), [("business_key", "remove".into())])
            .await
            .unwrap();
        test.db
            .insert(plain, &context(), [("business_key", "remove".into())])
            .await
            .unwrap();
        let kept = test
            .db
            .insert(plain, &context(), [("business_key", "keep".into())])
            .await
            .unwrap();
        let soft_id = test
            .db
            .insert(soft, &context(), [("business_key", "safe".into())])
            .await
            .unwrap();
        let mut tx = test.db.begin().await.unwrap();
        tx.delete_by_id(plain, first).await.unwrap();
        tx.rollback().await.unwrap();
        let mut tx = test.db.begin().await.unwrap();
        tx.delete_by_id(plain, first).await.unwrap();
        assert_eq!(
            tx.delete_by_id(plain, first).await.unwrap_err().code(),
            DATA_NOT_FOUND
        );
        assert_eq!(
            tx.delete_where(plain, Expr::col("business_key").eq("remove"))
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            tx.delete_by_id(soft, soft_id).await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            tx.delete_where(soft, Expr::col("id").eq(soft_id))
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        tx.commit().await.unwrap();
        let rows: Vec<(Id,)> = test
            .db
            .fetch_all(
                &select(plain)
                    .into_query()
                    .clear_selects()
                    .column("id")
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(rows, [(kept,)]);
        assert_eq!(test.rows::<(Id,)>("soft", &["id"]).await, [(soft_id,)]);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn transaction_commit_is_visible_and_drop_rolls_back() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let mut tx = test.db.begin().await.unwrap();
        tx.insert(RECORDS, &context(), [("business_key", "committed".into())])
            .await
            .unwrap();
        let rows: Vec<Record> = tx.fetch_all(&select(RECORDS).into_query()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert!(
            test.db
                .fetch_all::<Record>(&select(RECORDS).into_query())
                .await
                .unwrap()
                .is_empty()
        );
        tx.commit().await.unwrap();
        let mut tx = test.db.begin().await.unwrap();
        tx.insert(RECORDS, &context(), [("business_key", "dropped".into())])
            .await
            .unwrap();
        drop(tx);
        // 新写事务等待 SQLx 排队的 rollback 完成，不使用 sleep 猜测完成时刻。
        let mut tx = test.db.begin().await.unwrap();
        let rows: Vec<Record> = tx.fetch_all(&select(RECORDS).into_query()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].business_key, "committed");
        tx.commit().await.unwrap();
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn transaction_rollback_undoes_query_entry_writes() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let mut tx = test.db.begin().await.unwrap();
        let id = tx
            .insert(RECORDS, &context(), [("business_key", "first".into())])
            .await
            .unwrap();
        tx.update_by_id(
            RECORDS,
            &context(),
            id,
            Some(1),
            [("business_key", "second".into())],
        )
        .await
        .unwrap();
        tx.soft_delete_by_id(RECORDS, &context(), id, Some(2))
            .await
            .unwrap();
        tx.rollback().await.unwrap();
        assert!(
            test.db
                .fetch_all::<Record>(
                    &Query::select()
                        .from(RECORDS.name)
                        .column(sea_query::Asterisk)
                        .to_owned()
                )
                .await
                .unwrap()
                .is_empty()
        );
    })
    .await;
}
