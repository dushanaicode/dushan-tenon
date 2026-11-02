use super::*;
use std::sync::Mutex;
use tenon_framework::error::ErrorCode;

// 宿主端口的错误透传合同；account 不依赖配置实现所在的 desktop。
pub(super) const SETTINGS_OVERRIDDEN: ErrorCode = ErrorCode::new("app.settings.overridden");
const WRITE_FAILED: ErrorCode = ErrorCode::new("app.settings.write_failed");

pub(super) struct RecordingSettings {
    policy: MemoryAuthSettings,
    calls: Mutex<Vec<AuthMode>>,
    fail_at: usize,
    failure: ErrorCode,
}

impl RecordingSettings {
    pub(super) fn new(policy: AuthPolicy, fail_at: usize, failure: ErrorCode) -> Self {
        Self {
            policy: MemoryAuthSettings::new(policy),
            calls: Mutex::new(Vec::new()),
            fail_at,
            failure,
        }
    }
}

impl AuthSettings for RecordingSettings {
    fn read(&self) -> Result<AuthPolicy, AppError> {
        self.policy.read()
    }

    fn set_mode(&self, mode: AuthMode) -> Result<(), AppError> {
        let mut calls = self.calls.lock().unwrap();
        calls.push(mode);
        if calls.len() == self.fail_at {
            return Err(AppError::new(self.failure));
        }
        self.policy.set_mode(mode)
    }
}

#[tokio::test]
async fn config_write_failure_precedes_database_writes() {
    test_support::run(async |test| {
        let settings = Arc::new(RecordingSettings::new(
            policy(AuthMode::None),
            1,
            WRITE_FAILED,
        ));
        let service = start_with_settings(test, settings.clone(), clock())
            .await
            .unwrap();
        let ctx = context(&service).await;
        let error = service
            .enable_login(&ctx, PASSWORD.into())
            .await
            .err()
            .unwrap();
        assert_eq!(error.code(), WRITE_FAILED);
        assert_eq!(*settings.calls.lock().unwrap(), [AuthMode::Login]);
        assert_eq!(settings.read().unwrap().mode, AuthMode::None);
        assert_eq!(service.state().unwrap(), RuntimeState::None);
        let user = service.user(service.owner_id().unwrap()).await.unwrap();
        assert!(user.password_hash.is_none());
        assert_eq!(user.row_version, 1);
        assert!(test.rows::<(Id,)>(RECOVERY.name, &["id"]).await.is_empty());
        assert_eq!(
            test.rows::<(String, i64)>(SETTING.name, &["mode", "row_version"])
                .await,
            [("none".into(), 1)]
        );
    })
    .await;
}

#[tokio::test]
async fn database_failure_compensates_config_and_reports_compensation_failure() {
    for fail_at in [0, 2] {
        test_support::run(async |test| {
            let settings = Arc::new(RecordingSettings::new(
                policy(AuthMode::None),
                fail_at,
                WRITE_FAILED,
            ));
            let service = start_with_settings(test, settings.clone(), clock())
                .await
                .unwrap();
            let ctx = context(&service).await;
            test.raw("DELETE FROM account_auth_setting").await;
            let error = service
                .enable_login(&ctx, PASSWORD.into())
                .await
                .err()
                .unwrap();
            assert_eq!(
                *settings.calls.lock().unwrap(),
                [AuthMode::Login, AuthMode::None]
            );
            if fail_at == 2 {
                assert_eq!(error.code(), INTERNAL_UNEXPECTED);
                let source = std::error::Error::source(&error).unwrap().to_string();
                assert!(source.contains(STATE_INVALID.as_str()));
                assert!(source.contains(WRITE_FAILED.as_str()));
                assert_eq!(settings.read().unwrap().mode, AuthMode::Login);
            } else {
                assert_eq!(error.code(), STATE_INVALID);
                assert_eq!(settings.read().unwrap().mode, AuthMode::None);
            }
            assert_eq!(service.state().unwrap(), RuntimeState::None);
            let user = service.user(service.owner_id().unwrap()).await.unwrap();
            assert!(user.password_hash.is_none());
            assert_eq!(user.row_version, 1);
            assert!(test.rows::<(Id,)>(RECOVERY.name, &["id"]).await.is_empty());
        })
        .await;
    }
}

#[tokio::test]
async fn policy_reads_are_live_for_session_expiry_and_attempt_protection() {
    test_support::run(async |test| {
        let settings = Arc::new(MemoryAuthSettings::new(policy(AuthMode::None)));
        let time = clock();
        let service = start_with_settings(test, settings.clone(), time.clone())
            .await
            .unwrap();
        service
            .enable_login(&context(&service).await, PASSWORD.into())
            .await
            .unwrap();
        let id = service.session(false).await.unwrap().0;
        time.fetch_add(3_600_000, Ordering::SeqCst);
        // session 身份允许空闲锁，尚未触及原来的绝对期限。
        assert!(service.resolve_session().await.is_ok());
        settings
            .set_policy(AuthPolicy {
                session_max_hours: 1,
                ..settings.read().unwrap()
            })
            .unwrap();
        assert_eq!(
            service.resolve_session().await.unwrap_err().code(),
            SESSION_EXPIRED
        );
        assert_old_session_rejected(&service, &id).await;

        assert_eq!(
            service
                .attempt::<()>(None, async { Err(AppError::new(INVALID_CREDENTIALS)) })
                .await
                .unwrap_err()
                .code(),
            INVALID_CREDENTIALS
        );
        settings
            .set_policy(AuthPolicy {
                captcha_after_failures: 1,
                ..settings.read().unwrap()
            })
            .unwrap();
        assert_eq!(
            service
                .attempt::<()>(None, async { panic!("实时门禁必须先拒绝") })
                .await
                .unwrap_err()
                .code(),
            crate::CAPTCHA_REQUIRED
        );
        settings
            .set_policy(AuthPolicy {
                captcha_after_failures: 3,
                lock_after_failures: 4,
                lock_minutes: 1,
                ..settings.read().unwrap()
            })
            .unwrap();
        time.fetch_add(60_000, Ordering::SeqCst);
        service.attempt(None, async { Ok(()) }).await.unwrap();
    })
    .await;
}

struct UnreadableSettings;
impl AuthSettings for UnreadableSettings {
    fn read(&self) -> Result<AuthPolicy, AppError> {
        Err(AppError::new(INTERNAL_UNEXPECTED))
    }
    fn set_mode(&self, _: AuthMode) -> Result<(), AppError> {
        panic!("读取失败不能写配置")
    }
}

#[tokio::test]
async fn settings_read_errors_propagate_at_start_and_runtime() {
    test_support::run(async |test| {
        let result = start_with_settings(test, Arc::new(UnreadableSettings), clock()).await;
        assert_eq!(result.err().unwrap().code(), INTERNAL_UNEXPECTED);
        let mut service = start_service(test, policy(AuthMode::None), clock()).await;
        service
            .enable_login(&context(&service).await, PASSWORD.into())
            .await
            .unwrap();
        service.settings = Arc::new(UnreadableSettings);
        assert_eq!(
            service.resolve_public().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            service.auth_status().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            service
                .attempt::<()>(None, async {
                    panic!("策略读取失败不能校验凭据")
                })
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
    })
    .await;
}

#[tokio::test]
async fn poisoned_runtime_state_and_closed_operation_permit_return_errors() {
    test_support::run(async |test| {
        let service = start_service(test, policy(AuthMode::None), clock()).await;
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = service.started().unwrap().state.lock().unwrap();
            panic!("poison runtime state");
        }));
        assert_eq!(service.state().unwrap_err().code(), INTERNAL_UNEXPECTED);
        assert_eq!(
            service.set_state(RuntimeState::None).unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            service.expire("revoked").await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        service.operations.close();
        assert_eq!(
            service.auth_status().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            service.stop().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
    })
    .await;
}
