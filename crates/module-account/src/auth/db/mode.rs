use super::*;

#[tokio::test(flavor = "current_thread")]
async fn startup_table_and_invalid_singletons() {
    for (config_mode, stored_mode, password, expected) in [
        (AuthMode::None, "none", false, Some(RuntimeState::None)),
        (AuthMode::None, "none", true, Some(RuntimeState::None)),
        (
            AuthMode::None,
            "login",
            true,
            Some(RuntimeState::ConfirmRequired),
        ),
        (AuthMode::None, "login", false, None),
        (
            AuthMode::Login,
            "none",
            true,
            Some(RuntimeState::Login { session: None }),
        ),
        (
            AuthMode::Login,
            "login",
            true,
            Some(RuntimeState::Login { session: None }),
        ),
        (
            AuthMode::Login,
            "none",
            false,
            Some(RuntimeState::InitRequired),
        ),
        (
            AuthMode::Login,
            "login",
            false,
            Some(RuntimeState::InitRequired),
        ),
    ] {
        test_support::run(async |test| {
            test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
            let owner = ensure_owner(&test.db).await.unwrap();
            let ctx = ExecutionContext::new(Actor::System, "seed");
            if password {
                test.db
                    .update_by_id(
                        USER,
                        &ctx,
                        owner,
                        Some(1),
                        [("password_hash", "present".into())],
                    )
                    .await
                    .unwrap();
            }
            test.db
                .insert(SETTING, &ctx, [("mode", stored_mode.into())])
                .await
                .unwrap();
            let result = startup(&test.db, owner, config_mode).await;
            match expected {
                Some(ref expected) => assert_eq!(&result.unwrap(), expected),
                None => assert_eq!(result.unwrap_err().code(), STATE_INVALID),
            }
            let rows: Vec<AuthSetting> = test
                .db
                .fetch_all(&select(SETTING).into_query())
                .await
                .unwrap();
            assert_eq!(rows.len(), 1);
            let promoted = config_mode == AuthMode::Login && password;
            assert_eq!(rows[0].mode, if promoted { "login" } else { stored_mode });
            test.db
                .insert(SETTING, &ctx, [("mode", "none".into())])
                .await
                .unwrap();
            assert_eq!(
                startup(&test.db, owner, config_mode)
                    .await
                    .unwrap_err()
                    .code(),
                STATE_INVALID
            );
        })
        .await;
    }
}

#[tokio::test(flavor = "current_thread")]
async fn enable_login_stores_only_hashes_and_disable_revokes_credentials() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let ctx = context(&service).await;
        for error in [
            service.logout(&context(&service).await).await,
            service.lock().await,
            service.touch().await,
            service.unlock(&ctx, proof(PASSWORD)).await,
        ] {
            assert_eq!(error.unwrap_err().code(), MODE_CONFLICT);
        }
        let codes = service
            .enable_login(&ctx, PASSWORD.into())
            .await
            .unwrap()
            .recovery_codes;
        assert_eq!(codes.len(), 10);
        assert_eq!(
            codes
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            10
        );
        for code in &codes {
            assert_eq!(code.len(), 19);
            for (index, byte) in code.bytes().enumerate() {
                if [4, 9, 14].contains(&index) {
                    assert_eq!(byte, b'-');
                } else {
                    assert!(b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&byte));
                }
            }
        }
        assert_eq!(service.settings.read().unwrap().mode, AuthMode::Login);
        assert_eq!(
            service.auth_status().await.unwrap().state,
            AuthState::Active
        );
        assert_eq!(service.user_me(&ctx).await.unwrap().mode, AuthMode::Login);
        let user = service
            .user(service.started().unwrap().owner)
            .await
            .unwrap();
        assert_eq!(user.row_version, 2);
        assert!(
            user.password_hash
                .as_ref()
                .unwrap()
                .starts_with("$argon2id$v=19$m=19456,t=2,p=1$")
        );
        assert!(
            password::verify(PASSWORD.into(), user.password_hash)
                .await
                .unwrap()
        );
        let stored: Vec<(String, Option<Timestamp>)> =
            test.rows(RECOVERY.name, &["code_hash", "used_at"]).await;
        assert_eq!(stored.len(), 10);
        for (hash, used) in &stored {
            assert!(hash.starts_with("$argon2id$"));
            assert!(codes.iter().all(|code| !hash.contains(code)));
            assert!(used.is_none());
        }
        // SQL 不承诺无 ORDER BY 的行序，逐个匹配并移除，验证十组哈希一一对应。
        let mut hashes: Vec<_> = stored.into_iter().map(|(hash, _)| hash).collect();
        for code in &codes {
            let mut matched = None;
            for (index, hash) in hashes.iter().enumerate() {
                if password::verify(code.clone().into(), Some(hash.clone()))
                    .await
                    .unwrap()
                {
                    matched = Some(index);
                    break;
                }
            }
            hashes.remove(matched.expect("恢复码必须有对应的哈希"));
        }
        // 再次启动同一状态目录仍需独立登录。
        let other = start_service(test, service.settings.read().unwrap(), clock()).await;
        assert_eq!(
            other.auth_status().await.unwrap().state,
            AuthState::Anonymous
        );
        assert_eq!(
            other.resolve_active().await.unwrap_err().code(),
            AUTH_REQUIRED
        );
        assert_eq!(
            service
                .disable_login(&ctx, proof("wrong"))
                .await
                .unwrap_err()
                .code(),
            INVALID_CREDENTIALS
        );
        let old_session = service.session(false).await.unwrap().0;
        service.disable_login(&ctx, proof(PASSWORD)).await.unwrap();
        assert_old_session_rejected(&service, &old_session).await;
        assert_eq!(service.state().unwrap(), RuntimeState::None);
        assert_eq!(service.settings.read().unwrap().mode, AuthMode::None);
        let user = service
            .user(service.started().unwrap().owner)
            .await
            .unwrap();
        assert!(user.password_hash.is_none());
        let live: Vec<(Id,)> = test
            .db
            .fetch_all(
                &select(RECOVERY)
                    .into_query()
                    .clear_selects()
                    .column("id")
                    .to_owned(),
            )
            .await
            .unwrap();
        assert!(live.is_empty());
        let deleted: Vec<(Option<Timestamp>,)> = test.rows(RECOVERY.name, &["deleted_at"]).await;
        assert_eq!(deleted.len(), 10);
        assert!(deleted.iter().all(|(deleted,)| deleted.is_some()));
        let old_id = user.id;
        service
            .enable_login(&context(&service).await, PASSWORD.into())
            .await
            .unwrap();
        assert_eq!(
            service
                .user(service.started().unwrap().owner)
                .await
                .unwrap()
                .id,
            old_id
        );
        assert_eq!(test.rows::<(Id,)>(RECOVERY.name, &["id"]).await.len(), 20);
        assert_old_session_rejected(&service, &old_session).await;
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn initialize_confirm_and_login_credentials() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let initial = start_service(test, policy(AuthMode::Login), clock()).await;
        assert_eq!(
            initial.auth_status().await.unwrap().state,
            AuthState::InitRequired
        );
        assert_eq!(
            initial.resolve_active().await.unwrap_err().code(),
            INIT_REQUIRED
        );
        assert_eq!(
            initial.resolve_session().await.unwrap_err().code(),
            INIT_REQUIRED
        );
        assert_eq!(initial.resolve_public().await.unwrap(), None);
        initial.initialize(PASSWORD.into(), "init").await.unwrap();
        initial.logout(&context(&initial).await).await.unwrap();
        assert_eq!(initial.resolve_public().await.unwrap(), None);
        for password in ["bad", "incorrect-password"] {
            assert_eq!(
                initial
                    .login(LoginInput {
                        password: password.into(),
                        captcha: None,
                    })
                    .await
                    .unwrap_err()
                    .code(),
                INVALID_CREDENTIALS
            );
        }
        initial
            .login(LoginInput {
                password: PASSWORD.into(),
                captcha: None,
            })
            .await
            .unwrap();
        assert!(initial.resolve_public().await.unwrap().is_some());
        let old_id = initial.session(false).await.unwrap().0;
        initial.stop().await.unwrap();
        let confirm = start_service(test, policy(AuthMode::None), clock()).await;
        assert_eq!(
            confirm.auth_status().await.unwrap().state,
            AuthState::ConfirmRequired
        );
        assert_eq!(
            confirm.resolve_active().await.unwrap_err().code(),
            CONFIRM_REQUIRED
        );
        assert_eq!(confirm.resolve_public().await.unwrap(), None);
        assert_eq!(
            confirm
                .confirm_mode(proof("wrong"), "confirm")
                .await
                .unwrap_err()
                .code(),
            INVALID_CREDENTIALS
        );
        confirm
            .confirm_mode(proof(PASSWORD), "confirm")
            .await
            .unwrap();
        assert_eq!(
            confirm.auth_status().await.unwrap().state,
            AuthState::Active
        );
        assert_old_session_rejected(&initial, &old_id).await;
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn failed_transaction_rolls_back_settings_and_overrides_refuse_switch() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let ctx = context(&service).await;
        // 删除模式记录让事务在更新用户、插入恢复码之后失败，验证整个事务回滚。
        test.raw("DELETE FROM account_auth_setting").await;
        assert_eq!(
            service
                .enable_login(&ctx, PASSWORD.into())
                .await
                .err()
                .unwrap()
                .code(),
            STATE_INVALID
        );
        assert_eq!(service.settings.read().unwrap().mode, AuthMode::None);
        assert_eq!(service.state().unwrap(), RuntimeState::None);
        let user = service
            .user(service.started().unwrap().owner)
            .await
            .unwrap();
        assert!(user.password_hash.is_none());
        assert!(test.rows::<(Id,)>(RECOVERY.name, &["id"]).await.is_empty());
        let overridden = start_with_settings(
            test,
            Arc::new(RecordingSettings::new(
                policy(AuthMode::None),
                1,
                SETTINGS_OVERRIDDEN,
            )),
            clock(),
        )
        .await
        .unwrap();
        let error = overridden
            .enable_login(&context(&overridden).await, PASSWORD.into())
            .await
            .err()
            .unwrap();
        assert_eq!(error.code(), SETTINGS_OVERRIDDEN);
        assert_eq!(overridden.state().unwrap(), RuntimeState::None);
    })
    .await;
}

#[test]
fn password_rules_count_unicode_scalars() {
    for value in ["短密码", "        ", &"a".repeat(129)] {
        assert_eq!(
            password::validate(value).unwrap_err().code(),
            crate::PASSWORD_INVALID
        );
    }
    for value in [PASSWORD, "a       ", &"字".repeat(128)] {
        password::validate(value).unwrap();
    }
}

#[tokio::test(flavor = "current_thread")]
async fn disable_failure_rolls_back_and_non_owner_is_rejected() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let ctx = context(&service).await;
        service.enable_login(&ctx, PASSWORD.into()).await.unwrap();
        let wrong_actor = ExecutionContext::new(Actor::User(Id::new()), "other-user");
        assert_eq!(
            service
                .disable_login(&wrong_actor, proof(PASSWORD))
                .await
                .unwrap_err()
                .code(),
            MODE_CONFLICT
        );
        test.raw("DELETE FROM account_auth_setting").await;
        assert_eq!(
            service
                .disable_login(&ctx, proof(PASSWORD))
                .await
                .unwrap_err()
                .code(),
            STATE_INVALID
        );
        assert_eq!(service.settings.read().unwrap().mode, AuthMode::Login);
        assert_eq!(
            service.auth_status().await.unwrap().state,
            AuthState::Active
        );
        let owner = service
            .user(service.started().unwrap().owner)
            .await
            .unwrap();
        assert!(
            password::verify(PASSWORD.into(), owner.password_hash)
                .await
                .unwrap()
        );
        let live: Vec<(Id,)> = test
            .db
            .fetch_all(
                &select(RECOVERY)
                    .into_query()
                    .clear_selects()
                    .column("id")
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(live.len(), 10);
        let overridden = start_with_settings(
            test,
            Arc::new(RecordingSettings::new(
                policy(AuthMode::Login),
                1,
                SETTINGS_OVERRIDDEN,
            )),
            clock(),
        )
        .await
        .unwrap();
        overridden
            .login(LoginInput {
                password: PASSWORD.into(),
                captcha: None,
            })
            .await
            .unwrap();
        assert_eq!(
            overridden
                .disable_login(&ctx, proof(PASSWORD))
                .await
                .unwrap_err()
                .code(),
            SETTINGS_OVERRIDDEN
        );
    })
    .await;
}
