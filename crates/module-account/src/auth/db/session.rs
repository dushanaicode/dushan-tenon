use super::*;

#[tokio::test(flavor = "current_thread")]
async fn account_db_idle_policy_changes_session_lock() {
    test_support::run(async |test| {
        let time = clock();
        let service = start_service(test, policy(AuthMode::Login), time.clone()).await;
        service.initialize(PASSWORD.into(), "init").await.unwrap();
        let actor = context(&service).await;
        assert_eq!(service.auth_status().await.unwrap().idle_lock_minutes, 15);
        time.fetch_add(120_000, Ordering::SeqCst);
        assert!(service.resolve_active().await.is_ok());
        service
            .started()
            .unwrap()
            .params
            .set(&actor, "account.idle_lock_minutes", "1", None)
            .await
            .unwrap();
        assert_eq!(
            service.resolve_active().await.unwrap_err().code(),
            SESSION_LOCKED
        );
        let status = service.auth_status().await.unwrap();
        assert_eq!(status.idle_lock_minutes, 1);
        assert_eq!(status.state, AuthState::Locked);
        service
            .started()
            .unwrap()
            .params
            .set(&actor, "account.idle_lock_minutes", "10", Some(1))
            .await
            .unwrap();
        let status = service.auth_status().await.unwrap();
        assert_eq!(status.idle_lock_minutes, 10);
        assert_eq!(status.state, AuthState::Active);
        assert_eq!(service.resolve_active().await.unwrap().actor, actor.actor);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn idle_lock_unlock_and_absolute_expiry() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let clock = clock();
        let service = start_service(
            test,
            AuthPolicy {
                session_max_hours: 1,
                ..policy(AuthMode::Login)
            },
            clock.clone(),
        )
        .await;
        service.initialize(PASSWORD.into(), "init").await.unwrap();
        let ctx = context(&service).await;
        service
            .started()
            .unwrap()
            .params
            .set(&ctx, "account.idle_lock_minutes", "1", None)
            .await
            .unwrap();
        let (id, first, _) = service.session(false).await.unwrap();
        clock.fetch_add(60_000, Ordering::SeqCst);
        assert_eq!(
            service.resolve_active().await.unwrap_err().code(),
            SESSION_LOCKED
        );
        assert_eq!(service.resolve_session().await.unwrap(), ctx.actor);
        assert_eq!(service.resolve_public().await.unwrap(), None);
        assert_eq!(service.touch().await.unwrap_err().code(), SESSION_LOCKED);
        assert_eq!(
            service.auth_status().await.unwrap().state,
            AuthState::Locked
        );
        assert_eq!(
            service.unlock(&ctx, proof("bad")).await.unwrap_err().code(),
            INVALID_CREDENTIALS
        );
        service.unlock(&ctx, proof(PASSWORD)).await.unwrap();
        assert_eq!(service.resolve_active().await.unwrap().actor, ctx.actor);
        clock.fetch_add(30_000, Ordering::SeqCst);
        service.touch().await.unwrap();
        let (_, touched, _) = service.session(false).await.unwrap();
        assert_eq!(touched.created_at, first.created_at);
        assert_eq!(service.remaining(&touched).unwrap(), 3_510_000);
        // 即使缓存还在，注入的绝对时钟也不能延长总期限。
        clock.store(first.created_at.as_millis() + 3_600_000, Ordering::SeqCst);
        assert_eq!(
            service.auth_status().await.unwrap().state,
            AuthState::Anonymous
        );
        assert!(
            service
                .started()
                .unwrap()
                .cache
                .get(SESSION_NS, &id)
                .await
                .unwrap()
                .is_none()
        );
        service
            .login(LoginInput {
                password: PASSWORD.into(),
                captcha: None,
            })
            .await
            .unwrap();
        let (id, _, _) = service.session(false).await.unwrap();
        service
            .started()
            .unwrap()
            .cache
            .delete(SESSION_NS, &id)
            .await
            .unwrap();
        assert_eq!(
            service.resolve_active().await.unwrap_err().code(),
            SESSION_EXPIRED
        );
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resolution_does_not_wait_for_auth_operations() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let ctx = context(&service).await;
        for login in [false, true] {
            if login {
                service.enable_login(&ctx, PASSWORD.into()).await.unwrap();
            }
            let _permit = service.operations.acquire().await.unwrap();
            // 许可始终被占用；超时只用于让错误的排队实现及时失败。
            tokio::time::timeout(Duration::from_secs(5), async {
                assert_eq!(service.resolve_active().await.unwrap().actor, ctx.actor);
                assert_eq!(service.resolve_session().await.unwrap(), ctx.actor);
                assert_eq!(service.resolve_public().await.unwrap(), Some(ctx.actor));
            })
            .await
            .expect("身份解析不得等待认证操作许可");
        }
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resolution_expiring_old_session_preserves_new_login() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let ctx = context(&service).await;
        service.enable_login(&ctx, PASSWORD.into()).await.unwrap();
        let (old_id, _, _) = service.session(false).await.unwrap();
        service
            .login(LoginInput {
                password: PASSWORD.into(),
                captcha: None,
            })
            .await
            .unwrap();
        let (new_id, _, _) = service.session(false).await.unwrap();
        assert_ne!(old_id, new_id);
        // 模拟读取旧 ID 的解析，在新登录完成之后才执行过期清理。
        service.expire(&old_id).await.unwrap();
        assert_eq!(
            service.state().unwrap(),
            RuntimeState::Login {
                session: Some(new_id)
            }
        );
        assert_eq!(service.resolve_active().await.unwrap().actor, ctx.actor);
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
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resolution_idle_lock_does_not_write_session() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let clock = clock();
        let service = start_service(test, policy(AuthMode::None), clock.clone()).await;
        service
            .started()
            .unwrap()
            .params
            .set(
                &ExecutionContext::new(Actor::System, "idle-test"),
                "account.idle_lock_minutes",
                "1",
                None,
            )
            .await
            .unwrap();
        let ctx = context(&service).await;
        service.enable_login(&ctx, PASSWORD.into()).await.unwrap();
        let (id, _, _) = service.session(false).await.unwrap();
        let cache = &service.started().unwrap().cache;
        let before = cache.get(SESSION_NS, &id).await.unwrap().unwrap();
        clock.fetch_add(60_000, Ordering::SeqCst);
        assert_eq!(
            service.resolve_active().await.unwrap_err().code(),
            SESSION_LOCKED
        );
        assert_eq!(service.resolve_session().await.unwrap(), ctx.actor);
        assert_eq!(service.resolve_public().await.unwrap(), None);
        assert_eq!(service.touch().await.unwrap_err().code(), SESSION_LOCKED);
        assert_eq!(
            service.auth_status().await.unwrap().state,
            AuthState::Locked
        );
        let cached: Session = cache.get_json(SESSION_NS, &id).await.unwrap().unwrap();
        assert!(!cached.locked);
        assert_eq!(cache.get(SESSION_NS, &id).await.unwrap().unwrap(), before);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn storage_failures_are_not_anonymous() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let ctx = context(&service).await;
        service.enable_login(&ctx, PASSWORD.into()).await.unwrap();
        let (id, session, _) = service.session(false).await.unwrap();
        let cache = &service.started().unwrap().cache;
        cache
            .set(SESSION_NS, &id, b"invalid json", Duration::from_secs(60))
            .await
            .unwrap();
        assert_eq!(
            service.auth_status().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            service.resolve_public().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        service.save_session(&id, &session).await.unwrap();
        test.db.close().await;
        assert_eq!(
            service.resolve_public().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert!(service.auth_status().await.is_err());
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn session_replacement_failure_does_not_restore_revoked_session() {
    test_support::run(async |test| {
        let mut service = start_service(test, policy(AuthMode::None), clock()).await;
        let ctx = context(&service).await;
        service.enable_login(&ctx, PASSWORD.into()).await.unwrap();
        let old = service.session(false).await.unwrap().0;
        let user = service.user(service.owner_id().unwrap()).await.unwrap();
        service.clear_session().await.unwrap();
        // 创建会话后，写缓存前时钟已超过绝对期限。
        let time = clock();
        service.clock = Arc::new(move || {
            Timestamp::from_millis(time.fetch_add(86_400_000, Ordering::SeqCst)).unwrap()
        });
        assert_eq!(
            service.create_session(&user).await.unwrap_err().code(),
            SESSION_EXPIRED
        );
        assert_eq!(
            service.resolve_active().await.unwrap_err().code(),
            AUTH_REQUIRED
        );
        assert_old_session_rejected(&service, &old).await;
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn failed_cache_delete_still_clears_runtime_session() {
    test_support::run(async |test| {
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        service
            .set_state(RuntimeState::Login {
                session: Some("invalid:key".into()),
            })
            .unwrap();
        assert_eq!(
            service.clear_session().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            service.state().unwrap(),
            RuntimeState::Login { session: None }
        );
        assert_eq!(
            service.resolve_active().await.unwrap_err().code(),
            AUTH_REQUIRED
        );
    })
    .await;
}
