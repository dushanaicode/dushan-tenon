use super::*;
use crate::{
    AuthPolicy, AuthSettings,
    db::{DECLARATION, cache_config, migrations, policy, secrets, test_module},
    test_support::MemoryAuthSettings,
    users::ensure_owner,
};
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};
use tenon_framework::{
    cache::Cache,
    db::test_support::{self, TestDb},
    ipc::ActorResolver,
    module::{Module, ModuleContext, ModuleRegistry},
};

const PASSWORD: &str = "正确的八个字符密码";

mod protection;

async fn start_service(test: &TestDb, policy: AuthPolicy, clock: Arc<AtomicI64>) -> AccountService {
    start_with_settings(test, Arc::new(MemoryAuthSettings::new(policy)), clock)
        .await
        .unwrap()
}

async fn start_with_settings(
    test: &TestDb,
    settings: Arc<dyn AuthSettings>,
    clock: Arc<AtomicI64>,
) -> Result<AccountService, AppError> {
    let service = Arc::new(AccountService::new(settings, move || {
        Timestamp::from_millis(clock.load(Ordering::SeqCst)).unwrap()
    }));
    let registry =
        ModuleRegistry::new(vec![service.clone(), test_module()], &Default::default()).unwrap();
    test.upgrade(&registry.migrations(), 1).await.unwrap();
    let extensions = registry.freeze(vec![]).unwrap();
    let secrets = secrets(test);
    let cache = Cache::connect(&cache_config(), &secrets).await.unwrap();
    service
        .start(ModuleContext {
            extensions: &extensions,
            files: &tenon_framework::file::test_support::file_store(test, 20, &[]).unwrap(),
            translator: &(Arc::new(tenon_framework::i18n::TestTranslator)
                as Arc<dyn tenon_framework::i18n::Translator>),
            db: &test.db,
            cache: &cache,
            params: &tenon_framework::param::ParamStore::new(
                test.db.clone(),
                cache.clone(),
                secrets,
                &[(
                    "account",
                    crate::DECLARATION.permissions,
                    crate::DECLARATION.params,
                )],
            )
            .unwrap(),
            permissions: DECLARATION.permissions,
            dictionaries: DECLARATION.dictionaries,
        })
        .await?;
    drop(extensions);
    drop(registry);
    Ok(Arc::into_inner(service).unwrap())
}

pub(in super::super) fn clock() -> Arc<AtomicI64> {
    Arc::new(AtomicI64::new(1_700_000_000_000))
}
async fn context(service: &AccountService) -> ExecutionContext {
    ExecutionContext::new(service.resolve_active().await.unwrap().actor, "auth-test")
}

fn proof(password: &str) -> PasswordProof {
    PasswordProof {
        password: password.into(),
        captcha: None,
    }
}

mod critical_section;
mod password_change;

async fn assert_old_session_rejected(service: &AccountService, old_id: &str) {
    assert!(
        service
            .started()
            .unwrap()
            .cache
            .get(SESSION_NS, old_id)
            .await
            .unwrap()
            .is_none()
    );
    let current = service.state().unwrap();
    service
        .set_state(RuntimeState::Login {
            session: Some(old_id.into()),
        })
        .unwrap();
    assert_eq!(
        service.resolve_active().await.unwrap_err().code(),
        SESSION_EXPIRED
    );
    assert_eq!(
        service.resolve_session().await.unwrap_err().code(),
        AUTH_REQUIRED
    );
    service.set_state(current).unwrap();
}

mod mode;
mod restored;
mod session;
mod settings;
use settings::{RecordingSettings, SETTINGS_OVERRIDDEN};
