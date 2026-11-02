use std::error::Error;

use super::*;

#[tokio::test(flavor = "current_thread")]
async fn duplicate_update_assignments_report_internal_error_without_writing() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let id = insert_record(&test.db, "original").await;
        for column in ["business_key", "BUSINESS_KEY"] {
            let query = Query::update()
                .table(RECORDS.name)
                .values([
                    ("business_key", "first".into()),
                    ("updated_at", 0_i64.into()),
                ])
                .value(column, "second")
                .and_where(Expr::col("id").eq(id))
                .to_owned();
            let db_error = test.db.execute(&query).await.unwrap_err();
            let mut tx = test.db.begin().await.unwrap();
            let tx_error = tx.execute(&query).await.unwrap_err();
            // 校验在发送 SQL 前完成，PostgreSQL 事务也不会进入失败状态。
            let row: Record = tx
                .fetch_optional(&select(RECORDS).into_query())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.business_key, "original");
            tx.commit().await.unwrap();
            let connection_error = test
                .db
                .acquire()
                .await
                .unwrap()
                .execute(&query)
                .await
                .unwrap_err();
            for error in [db_error, tx_error, connection_error] {
                assert_eq!(error.code(), INTERNAL_UNEXPECTED);
                assert!(error.params.is_empty());
                assert!(matches!(
                    error.source().unwrap().downcast_ref::<ContractError>(),
                    Some(ContractError::DuplicateUpdateColumn(name)) if name == column
                ));
                assert!(error.source().unwrap().to_string().contains(column));
            }
        }
        assert_eq!(record(&test.db, id).await.business_key, "original");
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn insert_fills_system_and_user_audit_fields_and_initial_state() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let before = Timestamp::now();
        let system_id = insert_record(&test.db, "system").await;
        let user = Id::new();
        let user_context = ExecutionContext::new(Actor::User(user), "test-trace");
        assert_eq!(user_context.trace_id, "test-trace");
        let user_id = test
            .db
            .insert(RECORDS, &user_context, [("business_key", "user".into())])
            .await
            .unwrap();
        for (id, actor) in [
            (system_id, "system".to_owned()),
            (user_id, user.to_string()),
        ] {
            let row = record(&test.db, id).await;
            assert_eq!(row.id, id);
            assert_eq!(row.created_by, actor);
            assert_eq!(row.updated_by, actor);
            assert_eq!(row.created_at, row.updated_at);
            assert!(row.created_at >= before && row.created_at <= Timestamp::now());
            assert_eq!(row.row_version, 1);
            assert_eq!(row.deleted_at, None);
            assert_eq!(row.delete_token, "");
        }
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn update_preserves_creation_audit_and_increments_version() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let id = insert_record(&test.db, "before").await;
        let before = record(&test.db, id).await;
        let user = Id::new();
        test.db
            .update_by_id(
                RECORDS,
                &ExecutionContext::new(Actor::User(user), "update"),
                id,
                Some(1),
                [("business_key", "after".into())],
            )
            .await
            .unwrap();
        let row = record(&test.db, id).await;
        assert_eq!(row.business_key, "after");
        assert_eq!(
            (row.created_at, row.created_by),
            (before.created_at, before.created_by)
        );
        assert_eq!(row.updated_by, user.to_string());
        assert!(row.updated_at >= before.updated_at);
        assert_eq!(row.row_version, 2);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn reserved_columns_cannot_be_overridden_even_with_different_case() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let id = insert_record(&test.db, "original").await;
        for column in table::RESERVED_COLUMNS {
            for column in [column.to_string(), column.to_uppercase()] {
                let error = test
                    .db
                    .insert(RECORDS, &context(), [(column.as_str(), "override".into())])
                    .await
                    .unwrap_err();
                assert_eq!(error.code, INTERNAL_UNEXPECTED);
                assert!(error.source().unwrap().to_string().contains(&column));
                let error = test
                    .db
                    .update_by_id(
                        RECORDS,
                        &context(),
                        id,
                        Some(1),
                        [(column.as_str(), "override".into())],
                    )
                    .await
                    .unwrap_err();
                assert_eq!(error.code, INTERNAL_UNEXPECTED);
            }
        }
        let row = record(&test.db, id).await;
        assert_eq!(row.row_version, 1);
        assert_eq!(row.business_key, "original");
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn table_features_are_opt_in_and_version_arguments_are_explicit() {
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
        let id = test
            .db
            .insert(plain, &context(), [("business_key", "plain".into())])
            .await
            .unwrap();
        test.db
            .update_by_id(
                plain,
                &context(),
                id,
                None,
                [("business_key", "updated".into())],
            )
            .await
            .unwrap();
        test.db
            .update_by_id(
                plain,
                &context(),
                id,
                None,
                [("business_key", "updated".into())],
            )
            .await
            .unwrap();
        let row: Option<(Id, String)> = test
            .db
            .fetch_optional(&select(plain).into_query())
            .await
            .unwrap();
        assert_eq!(row.unwrap(), (id, "updated".to_owned()));
        let error = test
            .db
            .update_by_id(
                plain,
                &context(),
                id,
                Some(1),
                [("business_key", "wrong".into())],
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, INTERNAL_UNEXPECTED);
        let error = test
            .db
            .soft_delete_by_id(plain, &context(), id, None)
            .await
            .unwrap_err();
        assert_eq!(error.code, INTERNAL_UNEXPECTED);
        let soft_id = test
            .db
            .insert(soft, &context(), [("business_key", "soft".into())])
            .await
            .unwrap();
        test.db
            .soft_delete_by_id(soft, &context(), soft_id, None)
            .await
            .unwrap();
        assert!(
            test.db
                .fetch_optional::<(Id,)>(&select(soft).into_query())
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            test.db
                .fetch_optional::<(Id,)>(
                    &Query::select()
                        .from(soft.name)
                        .column(sea_query::Asterisk)
                        .to_owned()
                )
                .await
                .unwrap()
                .is_some()
        );
        let error = test
            .db
            .update_by_id(
                Table {
                    optimistic_lock: true,
                    ..plain
                },
                &context(),
                id,
                None,
                [],
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, INTERNAL_UNEXPECTED);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn case_sensitive_keys_and_remote_connection_defaults() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        insert_record(&test.db, "Case").await;
        insert_record(&test.db, "case").await;
        let query = select(RECORDS).into_query().and_where(Expr::col("business_key").eq("Case")).to_owned();
        let rows: Vec<Record> = test.db.fetch_all(&query).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].business_key, "Case");
        match &test.db.pool {
            pool::Pool::Sqlite(_) => {} // SQLite 连接选项由专用 PRAGMA 用例验证。
            pool::Pool::Mysql(pool) => {
                let mut connections = Vec::new();
                for _ in 0..4 {
                    let mut connection = pool.acquire().await.unwrap();
                    let (zone, mode, charset, collation, isolation): (String, String, String, String, String) =
                        sqlx::query_as("SELECT @@session.time_zone, @@session.sql_mode, @@session.character_set_connection, @@session.collation_connection, @@session.transaction_isolation")
                            .fetch_one(&mut *connection).await.unwrap();
                    assert_eq!(zone, "+00:00");
                    assert!(mode.split(',').any(|part| part == "STRICT_ALL_TABLES"));
                    assert_eq!(charset, "utf8mb4");
                    assert_eq!(collation, "utf8mb4_bin");
                    assert_eq!(isolation, "REPEATABLE-READ");
                    connections.push(connection);
                }
            }
            pool::Pool::Postgres(pool) => {
                let mut connections = Vec::new();
                for _ in 0..4 {
                    let mut connection = pool.acquire().await.unwrap();
                    let isolation: String = sqlx::query_scalar("SHOW transaction_isolation").fetch_one(&mut *connection).await.unwrap();
                    assert_eq!(isolation, "read committed");
                    connections.push(connection);
                }
            }
        }
    }).await;
}
