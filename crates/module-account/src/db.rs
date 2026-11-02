//! Account-only fixtures use their own migration and explicit test providers.
use super::users::ensure_owner;
use super::*;
use crate::test_support::MemoryAuthSettings;
use sea_query::Value;
use std::sync::Arc;
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    cache::Cache,
    db::{migrate, test_support},
    error::INTERNAL_UNEXPECTED,
    id::Id,
    ipc::ActorResolver,
    module::{Module, ModuleContext, ModuleDeclaration, ModuleFuture, ModuleRegistry},
    secret::SecretStore,
    time::Timestamp,
};

pub(super) use crate::migrations;
pub(super) const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "sample",
    version: "0.1.0",
    dependencies: &[],
    required_capabilities: &[],
    core: true,
    migrations: &[],
    error_codes: &[],
    job_kinds: &[],
    schedules: &[],
    permissions: &[
        "sample.service.read",
        "sample.service.manage",
        "sample.service.send",
    ],
    message_keys: &[],
    dictionaries: &[],
    params: &[],
    file_purposes: &[],
};

pub(super) struct TestModule;
impl Module for TestModule {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }
    fn start<'a>(&'a self, _: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}
pub(super) fn test_module() -> Arc<dyn Module> {
    Arc::new(TestModule)
}

pub(super) fn policy(mode: AuthMode) -> AuthPolicy {
    AuthPolicy {
        mode,
        session_max_hours: 24,
        captcha_after_failures: 3,
        lock_after_failures: 10,
        lock_minutes: 15,
    }
}

pub(super) fn cache_config() -> tenon_framework::cache::CacheConfig {
    tenon_framework::cache::CacheConfig {
        connection: tenon_framework::cache::CacheConnection::Local,
        key_prefix: "tenon-test-account".into(),
        local_capacity: std::num::NonZeroU64::new(10_000).unwrap(),
    }
}

pub(super) fn secrets(
    test: &test_support::TestDb,
) -> SecretStore<tenon_framework::secret::MemoryCredentials> {
    SecretStore::with_backend(
        test.root.path(),
        tenon_framework::secret::MemoryCredentials::default(),
    )
    .unwrap()
}

fn make_service() -> AccountService {
    AccountService::new(
        Arc::new(MemoryAuthSettings::new(policy(AuthMode::None))),
        Timestamp::now,
    )
}

pub(super) async fn fixture(
    test: &test_support::TestDb,
    clock: Arc<std::sync::atomic::AtomicI64>,
) -> (
    Arc<AccountService>,
    ModuleRegistry,
    tenon_framework::module::Extensions,
) {
    let account = Arc::new(AccountService::new(
        Arc::new(MemoryAuthSettings::new(policy(AuthMode::None))),
        move || Timestamp::from_millis(clock.load(std::sync::atomic::Ordering::SeqCst)).unwrap(),
    ));
    let mut registry = ModuleRegistry::new(
        vec![account.clone(), test_module(), Arc::new(OptionalModule)],
        &std::collections::BTreeMap::from([("optional".into(), false)]),
    )
    .unwrap();
    let extensions = registry.freeze(vec![]).unwrap();
    test.upgrade(&registry.migrations(), 1).await.unwrap();
    let secrets = secrets(test);
    let cache = Cache::connect(&cache_config(), &secrets).await.unwrap();
    registry
        .start(ModuleContext {
            extensions: &extensions,
            db: &test.db,
            cache: &cache,
            permissions: &registry.permissions(),
            dictionaries: &[],
            files: &tenon_framework::file::test_support::file_store(test, 20, &[]).unwrap(),
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
            translator: &(Arc::new(tenon_framework::i18n::TestTranslator)
                as Arc<dyn tenon_framework::i18n::Translator>),
        })
        .await
        .unwrap();
    (account, registry, extensions)
}

struct OptionalModule;
impl Module for OptionalModule {
    fn declaration(&self) -> &ModuleDeclaration {
        const OPTIONAL: ModuleDeclaration = ModuleDeclaration {
            id: "optional",
            core: false,
            migrations: &[],
            permissions: &["optional.feature.read"],
            ..DECLARATION
        };
        &OPTIONAL
    }
    fn start<'a>(&'a self, _: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test(flavor = "current_thread")]
async fn multiple_owners_are_rejected_without_repair() {
    test_support::run(async |test| {
        let service = Arc::new(make_service());
        let registry =
            ModuleRegistry::new(vec![service.clone(), test_module()], &Default::default()).unwrap();
        let extensions = registry.freeze(vec![]).unwrap();
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        ensure_owner(&test.db).await.unwrap();
        test.db
            .insert(
                USER,
                &ExecutionContext::new(Actor::System, "test"),
                [
                    ("display_name", "".into()),
                    ("password_hash", Value::String(None)),
                ],
            )
            .await
            .unwrap();
        assert_eq!(
            ensure_owner(&test.db).await.unwrap_err().code(),
            OWNER_INVALID
        );
        let cache = Cache::connect(&cache_config(), &secrets(test))
            .await
            .unwrap();
        assert_eq!(
            service
                .start(ModuleContext {
                    extensions: &extensions,
                    files: &tenon_framework::file::test_support::file_store(test, 20, &[]).unwrap(),
                    translator: &(std::sync::Arc::new(tenon_framework::i18n::TestTranslator)
                        as std::sync::Arc<dyn tenon_framework::i18n::Translator>),
                    db: &test.db,
                    cache: &cache,
                    params: &tenon_framework::param::ParamStore::new(
                        test.db.clone(),
                        cache.clone(),
                        tenon_framework::secret::SecretStore::with_backend(
                            test.root.path(),
                            tenon_framework::secret::MemoryCredentials::default()
                        )
                        .unwrap(),
                        &[(
                            "account",
                            crate::DECLARATION.permissions,
                            crate::DECLARATION.params
                        )]
                    )
                    .unwrap(),
                    permissions: DECLARATION.permissions,
                    dictionaries: DECLARATION.dictionaries,
                })
                .await
                .unwrap_err()
                .code(),
            OWNER_INVALID,
        );
        assert_eq!(test.rows::<(Id,)>("account_user", &["id"]).await.len(), 2);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn owner_schema_preserves_audit_and_optimistic_lock() {
    test_support::run(async |test| {
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let owner = ensure_owner(&test.db).await.unwrap();
        let context = ExecutionContext::new(Actor::User(owner), "test");
        test.db
            .update_by_id(
                USER,
                &context,
                owner,
                Some(1),
                [("display_name", "Owner".into())],
            )
            .await
            .unwrap();
        assert_eq!(
            test.db
                .update_by_id(
                    USER,
                    &context,
                    owner,
                    Some(1),
                    [("display_name", "stale".into())]
                )
                .await
                .unwrap_err()
                .code(),
            tenon_framework::error::DATA_VERSION_CONFLICT
        );
        let rows: Vec<(Id, String, String, String, i64)> = test
            .rows(
                "account_user",
                &[
                    "id",
                    "display_name",
                    "created_by",
                    "updated_by",
                    "row_version",
                ],
            )
            .await;
        assert_eq!(
            rows,
            vec![(owner, "Owner".into(), "system".into(), owner.to_string(), 2)]
        );
        assert_eq!(ensure_owner(&test.db).await.unwrap(), owner);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_before_start_returns_internal_error() {
    let service = make_service();
    assert_eq!(
        service.resolve_active().await.unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
}

#[tokio::test(flavor = "current_thread")]
async fn resolve_uses_started_owner_after_database_closes() {
    test_support::run(async |test| {
        let service = Arc::new(make_service());
        let registry =
            ModuleRegistry::new(vec![service.clone(), test_module()], &Default::default()).unwrap();
        let extensions = registry.freeze(vec![]).unwrap();
        test.upgrade(migrations::MIGRATIONS, 1).await.unwrap();
        let cache = Cache::connect(&cache_config(), &secrets(test))
            .await
            .unwrap();
        let context = ModuleContext {
            extensions: &extensions,
            files: &tenon_framework::file::test_support::file_store(test, 20, &[]).unwrap(),
            translator: &(std::sync::Arc::new(tenon_framework::i18n::TestTranslator)
                as std::sync::Arc<dyn tenon_framework::i18n::Translator>),
            db: &test.db,
            cache: &cache,
            params: &tenon_framework::param::ParamStore::new(
                test.db.clone(),
                cache.clone(),
                tenon_framework::secret::SecretStore::with_backend(
                    test.root.path(),
                    tenon_framework::secret::MemoryCredentials::default(),
                )
                .unwrap(),
                &[(
                    "account",
                    crate::DECLARATION.permissions,
                    crate::DECLARATION.params,
                )],
            )
            .unwrap(),
            permissions: DECLARATION.permissions,
            dictionaries: DECLARATION.dictionaries,
        };
        service.start(context).await.unwrap();
        let owner = ensure_owner(&test.db).await.unwrap();
        test.db.close().await;
        assert_eq!(
            service.resolve_active().await.unwrap().actor,
            Actor::User(owner)
        );
        assert_eq!(
            service.start(context).await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
    })
    .await;
}

#[test]
fn user_snapshots_cover_all_three_dialects() {
    for dialect in migrate::Dialect::ALL {
        assert!(
            migrations::MIGRATIONS[0]
                .sql(dialect)
                .contains("account_user")
        );
        let attempt = migrations::MIGRATIONS[0]
            .sql(dialect)
            .lines()
            .find(|line| line.contains("CREATE TABLE") && line.contains("account_login_attempt"))
            .unwrap();
        for column in [
            "account_login_attempt",
            "user_id",
            "failed_count",
            "last_failed_at",
            "locked_until",
            "uq_account_login_attempt_user_id",
        ] {
            assert!(attempt.contains(column), "缺少 {column}");
        }
        for column in ["created_at", "deleted_at", "row_version"] {
            assert!(!attempt.contains(column));
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn migrations_and_owner_survive_registry_restart_without_duplicates() {
    test_support::run(async |test| {
        let mut owner_id = None;
        for _ in 0..2 {
            let service = Arc::new(make_service());
            let mut registry =
                ModuleRegistry::new(vec![service.clone(), test_module()], &Default::default())
                    .unwrap();
            let extensions = registry.freeze(vec![]).unwrap();
            let report = test.upgrade(&registry.migrations(), 1).await.unwrap();
            assert!(report.pending.is_empty());
            assert_eq!(registry.list(&report.applied)[0].applied_migrations, 1);
            let cache = Cache::connect(&cache_config(), &secrets(test))
                .await
                .unwrap();
            registry
                .start(ModuleContext {
                    extensions: &extensions,
                    files: &tenon_framework::file::test_support::file_store(test, 20, &[]).unwrap(),
                    translator: &(std::sync::Arc::new(tenon_framework::i18n::TestTranslator)
                        as std::sync::Arc<dyn tenon_framework::i18n::Translator>),
                    db: &test.db,
                    cache: &cache,
                    params: &tenon_framework::param::ParamStore::new(
                        test.db.clone(),
                        cache.clone(),
                        tenon_framework::secret::SecretStore::with_backend(
                            test.root.path(),
                            tenon_framework::secret::MemoryCredentials::default(),
                        )
                        .unwrap(),
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
                .await
                .unwrap();
            let actor = service.resolve_active().await.unwrap().actor;
            let me = service
                .user_me(&ExecutionContext::new(actor, "test-trace"))
                .await
                .unwrap();
            assert_eq!(actor, Actor::User(me.id));
            assert!(me.display_name.is_empty());
            assert_eq!(me.mode, AuthMode::None);
            if let Some(id) = owner_id {
                assert_eq!(me.id, id);
            }
            owner_id = Some(me.id);
            registry.stop().await.unwrap();
        }
        let users: Vec<(Id, Option<String>, i64, String)> = test
            .rows(
                "account_user",
                &["id", "password_hash", "row_version", "created_by"],
            )
            .await;
        assert_eq!(users.len(), 1);
        assert_eq!(Some(users[0].0), owner_id);
        assert!(users[0].1.is_none());
        assert_eq!(users[0].2, 1);
        assert_eq!(users[0].3, "system");
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn account_starts_alone_and_rejects_disabling_the_core_module() {
    test_support::run(async |test| {
        let account = Arc::new(make_service());
        let declaration = account.declaration();
        assert_eq!(declaration.id, "account");
        assert!(declaration.core);
        assert!(declaration.dependencies.is_empty());
        assert!(declaration.required_capabilities.is_empty());
        assert_eq!(declaration.permissions, &["account.security.manage"]);
        assert!(declaration.job_kinds.is_empty());
        assert!(declaration.schedules.is_empty());
        assert_eq!(declaration.params.len(), 1);
        assert_eq!(declaration.params[0].key, "account.idle_lock_minutes");
        assert!(declaration.file_purposes.is_empty());
        assert_eq!(declaration.error_codes.len(), 14);
        assert!(declaration.error_codes.iter().all(|code| code.as_str().starts_with("account.")));
        assert!(declaration.dictionaries.is_empty());
        let mut registry = ModuleRegistry::new(vec![account.clone()], &Default::default()).unwrap();
        registry.check_capabilities(&[]).unwrap();
        let extensions = registry.freeze(vec![]).unwrap();
        let identity = extensions.identity();
        assert!(Arc::ptr_eq(&identity.actor_resolver, &(account.clone() as Arc<dyn ActorResolver>)));
        test.upgrade(&registry.migrations(), 1).await.unwrap();
        let secrets = SecretStore::with_backend(test.root.path(), tenon_framework::secret::MemoryCredentials::default()).unwrap();
        let cache = Cache::connect(&cache_config(), &secrets).await.unwrap();
        registry.start(ModuleContext {
            extensions: &extensions,
            db: &test.db,
            cache: &cache,
            permissions: &registry.permissions(),
            dictionaries: &registry.dictionaries(),
            params: &tenon_framework::param::ParamStore::new(test.db.clone(), cache.clone(), secrets, &[("account", crate::DECLARATION.permissions, crate::DECLARATION.params)]).unwrap(),
            files: &tenon_framework::file::test_support::file_store(test, 20, &[]).unwrap(),
            translator: &(Arc::new(tenon_framework::i18n::TestTranslator) as Arc<dyn tenon_framework::i18n::Translator>),
        }).await.unwrap();
        let status = account.auth_status().await.unwrap();
        assert_eq!(status.state, AuthState::Active);
        assert_eq!(status.user.unwrap().id, account.owner_id().unwrap());
        let disabled = std::collections::BTreeMap::from([("account".into(), false)]);
        let result = ModuleRegistry::new(vec![account], &disabled);
        assert!(matches!(result, Err(tenon_framework::module::RegistryError::CoreDisabled(module)) if module == "account"));
        registry.stop().await.unwrap();
    }).await;
}

#[tokio::test(flavor = "current_thread")]
async fn account_first_migration_contains_all_four_table_contracts() {
    assert_eq!(migrations::MIGRATIONS.len(), 1);
    for dialect in migrate::Dialect::ALL {
        let sql = migrations::MIGRATIONS[0].sql(dialect).replace('`', "\"");
        assert_eq!(
            sql.lines()
                .filter(|line| line.starts_with("CREATE TABLE"))
                .count(),
            4
        );
        for (name, columns) in [
            (
                "account_user",
                &[
                    "id",
                    "display_name",
                    "password_hash",
                    "created_at",
                    "created_by",
                    "updated_at",
                    "updated_by",
                    "row_version",
                ][..],
            ),
            (
                "account_auth_setting",
                &[
                    "id",
                    "mode",
                    "created_at",
                    "created_by",
                    "updated_at",
                    "updated_by",
                    "row_version",
                ][..],
            ),
            (
                "account_recovery_code",
                &[
                    "id",
                    "user_id",
                    "code_hash",
                    "used_at",
                    "created_at",
                    "created_by",
                    "updated_at",
                    "updated_by",
                    "deleted_at",
                    "delete_token",
                ][..],
            ),
            (
                "account_login_attempt",
                &["user_id", "failed_count", "last_failed_at", "locked_until"][..],
            ),
        ] {
            let table = sql
                .lines()
                .find(|line| line.starts_with(&format!("CREATE TABLE \"{name}\"")))
                .unwrap();
            for column in columns {
                assert!(table.contains(&format!("\"{column}\" ")), "{name}.{column}");
            }
        }
        let name = "uq_account_login_attempt_user_id";
        // MySQL spells table constraints UNIQUE KEY before the name.
        assert!(
            sql.contains(&format!("\"{name}\" UNIQUE"))
                || sql.contains(&format!("UNIQUE KEY \"{name}\""))
        );
        assert!(sql.contains("CREATE INDEX \"ix_account_recovery_code_user_id\" ON \"account_recovery_code\" (\"user_id\")"));
        assert!(!sql.contains("ALTER TABLE"));
    }
    test_support::assert_migrated_schema(migrations::MIGRATIONS).await;
}
