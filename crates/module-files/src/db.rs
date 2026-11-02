use std::{num::NonZeroU64, sync::Arc};

use tenon_framework::{
    cache::{Cache, CacheConfig, CacheConnection},
    db::test_support::TestDb,
    file::{DEFAULT_MAX_MIB, test_support::file_store},
    i18n::{TestTranslator, Translator},
    module::{ModuleContext, ModuleRegistry},
    param::ParamStore,
    secret::{MemoryCredentials, SecretStore},
    time::Timestamp,
};
use tenon_module_account::{
    AccountService, AuthMode, AuthPolicy, test_support::MemoryAuthSettings,
};

use crate::FilesModule;

pub(crate) async fn setup(test: &TestDb) -> (Arc<AccountService>, ModuleRegistry) {
    let account = Arc::new(AccountService::new(
        Arc::new(MemoryAuthSettings::new(AuthPolicy {
            mode: AuthMode::None,
            session_max_hours: 24,
            captcha_after_failures: 3,
            lock_after_failures: 10,
            lock_minutes: 15,
        })),
        Timestamp::now,
    ));
    let mut registry = ModuleRegistry::new(
        vec![account.clone(), Arc::new(FilesModule)],
        &Default::default(),
    )
    .unwrap();
    let extensions = registry.freeze(vec![]).unwrap();
    test.upgrade(&registry.migrations(), 1).await.unwrap();
    let secrets =
        SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
    let cache = Cache::connect(
        &CacheConfig {
            connection: CacheConnection::Local,
            key_prefix: "tenon-test-files".into(),
            local_capacity: NonZeroU64::new(10_000).unwrap(),
        },
        &secrets,
    )
    .await
    .unwrap();
    let params = ParamStore::new(
        test.db.clone(),
        cache.clone(),
        secrets,
        &registry
            .declarations()
            .map(|declaration| (declaration.id, declaration.permissions, declaration.params))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    registry
        .start(ModuleContext {
            extensions: &extensions,
            files: &file_store(test, DEFAULT_MAX_MIB, &registry.file_purposes()).unwrap(),
            translator: &(Arc::new(TestTranslator) as Arc<dyn Translator>),
            db: &test.db,
            cache: &cache,
            params: &params,
            permissions: &registry.permissions(),
            dictionaries: &registry.dictionaries(),
        })
        .await
        .unwrap();
    (account, registry)
}
