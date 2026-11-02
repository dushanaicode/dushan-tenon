use super::*;

#[tokio::test(flavor = "current_thread")]
async fn restored_password_hashes_accept_empty_tables() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        AccountService::check_restored_password_hashes(&test.db)
            .await
            .unwrap();
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn restored_password_hashes_accept_null_password_and_generated_hashes() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let owner = ensure_owner(&test.db).await.unwrap();
        AccountService::check_restored_password_hashes(&test.db)
            .await
            .unwrap();
        let hash = password::hash_password(PASSWORD.into()).await.unwrap();
        let ctx = ExecutionContext::new(Actor::System, "restore-test");
        test.db
            .update_by_id(
                USER,
                &ctx,
                owner,
                Some(1),
                [("password_hash", hash.expose_secret().into())],
            )
            .await
            .unwrap();
        test.db
            .insert(
                RECOVERY,
                &ctx,
                [
                    ("user_id", owner.into()),
                    ("code_hash", hash.expose_secret().into()),
                    ("used_at", Value::BigInt(None)),
                ],
            )
            .await
            .unwrap();
        AccountService::check_restored_password_hashes(&test.db)
            .await
            .unwrap();
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn restored_password_hashes_reject_owner_cost() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let owner = ensure_owner(&test.db).await.unwrap();
        let ctx = ExecutionContext::new(Actor::System, "restore-test");
        test.db
            .update_by_id(
                USER,
                &ctx,
                owner,
                Some(1),
                [("password_hash", "$argon2id$v=19$m=4294967295,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into())],
            )
            .await
            .unwrap();
        assert_eq!(
            AccountService::check_restored_password_hashes(&test.db)
                .await
                .unwrap_err()
                .code(),
            tenon_framework::backup::INVALID_ARCHIVE,
        );

    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn restored_password_hashes_reject_recovery_cost_including_used_and_deleted_rows() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let owner = ensure_owner(&test.db).await.unwrap();
        let ctx = ExecutionContext::new(Actor::System, "restore-test");
        let code = test.db
            .insert(
                RECOVERY,
                &ctx,
                [
                    ("user_id", owner.into()),
                    ("code_hash", "$argon2id$v=19$m=19456,t=4294967295,p=1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into()),
                    ("used_at", 1_i64.into()),
                ],
            )
            .await
            .unwrap();
        assert_eq!(
            AccountService::check_restored_password_hashes(&test.db)
                .await
                .unwrap_err()
                .code(),
            tenon_framework::backup::INVALID_ARCHIVE,
        );
        test.db
            .soft_delete_by_id(RECOVERY, &ctx, code, None)
            .await
            .unwrap();
        assert_eq!(
            AccountService::check_restored_password_hashes(&test.db)
                .await
                .unwrap_err()
                .code(),
            tenon_framework::backup::INVALID_ARCHIVE,
        );
    })
    .await;
}
