use super::*;
use crate::{CAPTCHA_INVALID, CAPTCHA_REQUIRED, TEMPORARILY_LOCKED, captcha};

fn login(password: &str, captcha: Option<CaptchaAnswer>) -> LoginInput {
    LoginInput {
        password: password.into(),
        captcha,
    }
}

async fn answer(service: &AccountService) -> CaptchaAnswer {
    let challenge = service.captcha().await.unwrap();
    let answer = service
        .started()
        .unwrap()
        .cache
        .get("account.captcha", &challenge.id)
        .await
        .unwrap()
        .unwrap();
    CaptchaAnswer {
        id: challenge.id,
        answer: format!(" {} ", String::from_utf8(answer).unwrap().to_lowercase()),
    }
}

async fn count(test: &TestDb) -> i32 {
    let mut query = sea_query::Query::select();
    query.column("failed_count").from("account_login_attempt");
    let (count,): (i32,) = test.db.fetch_optional(&query).await.unwrap().unwrap();
    count
}

fn assert_locked(error: AppError, minutes: i64) {
    // AppError 只公开 code；完整 Debug 比较同时核对其私有参数，且此处没有秘密。
    assert_eq!(
        format!("{error:?}"),
        format!(
            "{:?}",
            AppError::new(TEMPORARILY_LOCKED).with_param("minutes", minutes.to_string())
        )
    );
}

#[tokio::test(flavor = "current_thread")]
async fn login_counts_owner_failures_and_captcha_guards_never_verify_credentials() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(
            test,
            AuthPolicy {
                captcha_after_failures: 2,
                ..policy(AuthMode::Login)
            },
            clock(),
        )
        .await;
        service.initialize(PASSWORD.into(), "init").await.unwrap();
        service.logout(&context(&service).await).await.unwrap();
        for _ in 0..2 {
            assert_eq!(
                service
                    .login(login("wrong", None))
                    .await
                    .unwrap_err()
                    .code(),
                INVALID_CREDENTIALS
            );
        }
        assert_eq!(
            service
                .login(login(PASSWORD, None))
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_REQUIRED
        );
        assert_eq!(
            service
                .attempt::<()>(None, async { panic!("不得验证密码") })
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_REQUIRED
        );
        let mut wrong = answer(&service).await;
        wrong.answer = "wrong".into();
        assert_eq!(
            service
                .attempt::<()>(Some(wrong), async {
                    panic!("验证码错误时不得验证密码")
                })
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_INVALID
        );
        assert_eq!(count(test).await, 2);
        service
            .login(login(PASSWORD, Some(answer(&service).await)))
            .await
            .unwrap();
        assert_eq!(count(test).await, 0);
        let rows: Vec<(Id,)> = test.rows("account_login_attempt", &["user_id"]).await;
        assert_eq!(rows, vec![(service.owner_id().unwrap(),)]);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn protection_lock_rounding_expiry_window_reset_and_restart() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let clock = clock();
        let protection = AuthPolicy {
            captcha_after_failures: 1,
            lock_after_failures: 3,
            lock_minutes: 2,
            ..policy(AuthMode::None)
        };
        let service = start_service(test, protection, clock.clone()).await;
        for index in 0..3 {
            let captcha = if index > 0 {
                Some(answer(&service).await)
            } else {
                None
            };
            let result: Result<(), _> = service
                .attempt(captcha, async { Err(AppError::new(INVALID_CREDENTIALS)) })
                .await;
            if index == 2 {
                assert_locked(result.unwrap_err(), 2);
            } else {
                assert_eq!(result.unwrap_err().code(), INVALID_CREDENTIALS);
            }
        }
        let restarted = start_service(test, protection, clock.clone()).await;
        for (advance, minutes) in [(0, 2), (59_999, 2), (1, 1), (59_999, 1)] {
            clock.fetch_add(advance, Ordering::SeqCst);
            assert_locked(
                restarted
                    .attempt::<()>(None, async { panic!("锁定期间不得校验") })
                    .await
                    .unwrap_err(),
                minutes,
            );
        }
        assert_eq!(count(test).await, 3);
        clock.fetch_add(1, Ordering::SeqCst);
        let failed: Result<(), _> = restarted
            .attempt(None, async { Err(AppError::new(INVALID_CREDENTIALS)) })
            .await;
        assert_eq!(failed.unwrap_err().code(), INVALID_CREDENTIALS);
        assert_eq!(count(test).await, 1);
        clock.fetch_add(120_000, Ordering::SeqCst);
        restarted.attempt(None, async { Ok(()) }).await.unwrap();
        assert_eq!(count(test).await, 0);
        let row: Vec<(Option<i64>, i64)> = test
            .rows("account_login_attempt", &["locked_until", "last_failed_at"])
            .await;
        assert_eq!(row, vec![(None, 0)]);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn concurrent_completed_attempts_do_not_lose_counts_or_hold_a_hash_transaction() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        service.attempt(None, async { Ok(()) }).await.unwrap();
        let other = start_service(test, policy(AuthMode::None), clock()).await;
        let barrier = tokio::sync::Barrier::new(2);
        let verify = || async {
            barrier.wait().await;
            // 若持有 SQLite 写事务，第二次尝试无法到达 barrier，或本次 begin 会失败。
            let tx = test.db.begin().await?;
            tx.commit().await?;
            Err::<(), _>(AppError::new(INVALID_CREDENTIALS))
        };
        let (a, b) = tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(
                service.attempt(None, verify()),
                other.attempt(None, verify())
            )
        })
        .await
        .unwrap();
        assert_eq!(a.unwrap_err().code(), INVALID_CREDENTIALS);
        assert_eq!(b.unwrap_err().code(), INVALID_CREDENTIALS);
        assert_eq!(count(test).await, 2);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn captcha_is_case_insensitive_single_use_and_expiring() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let cache = &service.started().unwrap().cache;
        let correct = answer(&service).await;
        let again = CaptchaAnswer {
            id: correct.id.clone(),
            answer: correct.answer.clone(),
        };
        let (first, second) = tokio::join!(
            captcha::verify(cache, correct),
            captcha::verify(cache, again)
        );
        assert_ne!(first.unwrap(), second.unwrap());
        let correct = answer(&service).await;
        assert!(
            !captcha::verify(
                cache,
                CaptchaAnswer {
                    id: correct.id.clone(),
                    answer: "wrong".into()
                }
            )
            .await
            .unwrap()
        );
        assert!(!captcha::verify(cache, correct).await.unwrap());
        let expired = answer(&service).await;
        cache
            .set(
                "account.captcha",
                &expired.id,
                expired.answer.trim().as_bytes(),
                Duration::from_millis(1),
            )
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(!captcha::verify(cache, expired).await.unwrap());
        assert!(
            !captcha::verify(
                cache,
                CaptchaAnswer {
                    id: "bad:key".into(),
                    answer: "x".into()
                }
            )
            .await
            .unwrap()
        );
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn unlock_confirm_disable_and_regenerate_share_owner_protection() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let clock = clock();
        let service = start_service(
            test,
            AuthPolicy {
                captcha_after_failures: 1,
                ..policy(AuthMode::None)
            },
            clock.clone(),
        )
        .await;
        let ctx = context(&service).await;
        service.enable_login(&ctx, PASSWORD.into()).await.unwrap();
        assert_eq!(
            service
                .disable_login(&ctx, proof("wrong"))
                .await
                .unwrap_err()
                .code(),
            INVALID_CREDENTIALS
        );
        assert_eq!(
            service
                .disable_login(&ctx, proof(PASSWORD))
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_REQUIRED
        );
        assert_eq!(
            service
                .recovery_regenerate(&ctx, proof(PASSWORD))
                .await
                .err()
                .unwrap()
                .code(),
            CAPTCHA_REQUIRED
        );
        service.lock().await.unwrap();
        assert_eq!(
            service
                .unlock(&ctx, proof(PASSWORD))
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_REQUIRED
        );
        service
            .unlock(
                &ctx,
                PasswordProof {
                    password: PASSWORD.into(),
                    captcha: Some(answer(&service).await),
                },
            )
            .await
            .unwrap();
        assert_eq!(count(test).await, 0);
        service.lock().await.unwrap();
        assert_eq!(
            service
                .unlock(&ctx, proof("wrong"))
                .await
                .unwrap_err()
                .code(),
            INVALID_CREDENTIALS
        );
        let confirm = start_service(
            test,
            AuthPolicy {
                captcha_after_failures: 1,
                ..policy(AuthMode::None)
            },
            clock,
        )
        .await;
        assert_eq!(
            confirm
                .confirm_mode(proof(PASSWORD), "confirm")
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_REQUIRED
        );
        assert_eq!(count(test).await, 1);
        confirm
            .confirm_mode(
                PasswordProof {
                    password: PASSWORD.into(),
                    captcha: Some(answer(&confirm).await),
                },
                "confirm",
            )
            .await
            .unwrap();
        assert_eq!(count(test).await, 0);
    })
    .await;
}

fn recovery(code: &str) -> RecoverInput {
    RecoverInput {
        recovery_code: code.into(),
        new_password: "new-password".into(),
        captcha: None,
    }
}

#[tokio::test(flavor = "current_thread")]
async fn recovery_consumes_code_changes_password_and_replaces_all_old_sessions() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let clock = clock();
        let service = start_service(test, policy(AuthMode::None), clock.clone()).await;
        assert_eq!(
            service
                .recover(recovery("bad"), "recover")
                .await
                .err()
                .unwrap()
                .code(),
            MODE_CONFLICT
        );
        let codes = service
            .enable_login(&context(&service).await, PASSWORD.into())
            .await
            .unwrap()
            .recovery_codes;
        let old_id = service.session(false).await.unwrap().0;
        let owner = service
            .user(service.started().unwrap().owner)
            .await
            .unwrap();
        let formatted = format!(" \n{} ", codes[0].replace('-', "").to_lowercase());
        let result = service
            .recover(recovery(&formatted), "recover")
            .await
            .unwrap();
        assert_eq!(result.remaining_codes, 9);
        assert_eq!(service.recovery_remaining().await.unwrap().remaining, 9);
        assert_eq!(
            service.auth_status().await.unwrap().state,
            AuthState::Active
        );
        assert_ne!(service.session(false).await.unwrap().0, old_id);
        assert!(
            service
                .started()
                .unwrap()
                .cache
                .get(SESSION_NS, &old_id)
                .await
                .unwrap()
                .is_none()
        );
        assert_old_session_rejected(&service, &old_id).await;
        let updated = service.user(owner.id).await.unwrap();
        assert_eq!(updated.row_version, owner.row_version + 1);
        assert!(
            password::verify("new-password".into(), updated.password_hash.clone())
                .await
                .unwrap()
        );
        assert!(
            !password::verify(PASSWORD.into(), updated.password_hash)
                .await
                .unwrap()
        );
        let used: Vec<(Option<Timestamp>,)> = test.rows(RECOVERY.name, &["used_at"]).await;
        assert_eq!(used.iter().filter(|(used,)| used.is_some()).count(), 1);
        assert_eq!(
            used.into_iter()
                .find_map(|(used,)| used)
                .unwrap()
                .as_millis(),
            clock.load(Ordering::SeqCst)
        );
        assert_eq!(
            service
                .recover(recovery(&codes[0]), "reuse")
                .await
                .err()
                .unwrap()
                .code(),
            INVALID_CREDENTIALS
        );
        assert_eq!(count(test).await, 1);
        let mut invalid_password = recovery(&codes[1]);
        invalid_password.new_password = "short".into();
        assert_eq!(
            service
                .recover(invalid_password, "invalid")
                .await
                .err()
                .unwrap()
                .code(),
            crate::PASSWORD_INVALID
        );
        assert_eq!(count(test).await, 1);
        assert_eq!(
            service
                .recover(recovery(&codes[1].to_lowercase()), "next")
                .await
                .unwrap()
                .remaining_codes,
            8
        );
        assert_eq!(count(test).await, 0);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn regeneration_revokes_old_codes_preserves_session_and_recovery_is_protected() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(
            test,
            AuthPolicy {
                captcha_after_failures: 1,
                ..policy(AuthMode::None)
            },
            clock(),
        )
        .await;
        let ctx = context(&service).await;
        let old = service
            .enable_login(&ctx, PASSWORD.into())
            .await
            .unwrap()
            .recovery_codes;
        let session_id = service.session(false).await.unwrap().0;
        assert_eq!(
            service
                .recovery_regenerate(&ctx, proof("wrong"))
                .await
                .err()
                .unwrap()
                .code(),
            INVALID_CREDENTIALS
        );
        let regenerated = service
            .recovery_regenerate(
                &ctx,
                PasswordProof {
                    password: PASSWORD.into(),
                    captcha: Some(answer(&service).await),
                },
            )
            .await
            .unwrap()
            .recovery_codes;
        assert_eq!(regenerated.len(), 10);
        assert_eq!(service.recovery_remaining().await.unwrap().remaining, 10);
        assert_eq!(service.session(false).await.unwrap().0, session_id);
        assert_eq!(
            service
                .recover(recovery(&old[0]), "old")
                .await
                .err()
                .unwrap()
                .code(),
            INVALID_CREDENTIALS
        );
        assert_eq!(
            service
                .recover(recovery(&regenerated[0]), "guard")
                .await
                .err()
                .unwrap()
                .code(),
            CAPTCHA_REQUIRED
        );
        let mut recover = recovery(&regenerated[0]);
        recover.captcha = Some(answer(&service).await);
        assert_eq!(
            service
                .recover(recover, "new")
                .await
                .unwrap()
                .remaining_codes,
            9
        );
        assert_eq!(
            service
                .recover(recovery("bad-format"), "invalid")
                .await
                .err()
                .unwrap()
                .code(),
            INVALID_CREDENTIALS
        );
        assert_eq!(count(test).await, 1);
    })
    .await;
}
