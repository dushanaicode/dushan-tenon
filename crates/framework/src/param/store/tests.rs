use super::*;
use crate::{
    actor::Actor,
    cache::{CacheConfig, CacheConnection, DEFAULT_LOCAL_CAPACITY},
    db::test_support::{self, TestDb},
    secret::{CredentialError, MemoryCredentials, SECRET_UNAVAILABLE},
};
use sea_query::Query;
use std::sync::atomic::{AtomicBool, Ordering};

const DECLARATIONS: &[ParamDeclaration] = &[
    ParamDeclaration {
        key: "test.text",
        kind: ParamKind::Text { max_chars: 4 },
        default: "初始",
        group: "test.settings",
        order: 0,
        read_permission: None,
        write_permission: None,
        effect: super::super::ParamEffect::NextRead,
    },
    ParamDeclaration {
        key: "test.int",
        kind: ParamKind::Integer { min: -2, max: 8 },
        default: "3",
        group: "test.settings",
        order: 0,
        read_permission: None,
        write_permission: None,
        effect: super::super::ParamEffect::NextRead,
    },
    ParamDeclaration {
        key: "test.bool",
        kind: ParamKind::Boolean,
        default: "false",
        group: "test.settings",
        order: 0,
        read_permission: None,
        write_permission: None,
        effect: super::super::ParamEffect::NextRead,
    },
    ParamDeclaration {
        key: "test.choice",
        kind: ParamKind::Choice {
            values: &["first", "second"],
        },
        default: "first",
        group: "test.settings",
        order: 0,
        read_permission: None,
        write_permission: None,
        effect: super::super::ParamEffect::NextRead,
    },
    ParamDeclaration {
        key: "test.secret",
        kind: ParamKind::Secret,
        default: "",
        group: "test.settings",
        order: 0,
        read_permission: None,
        write_permission: None,
        effect: super::super::ParamEffect::NextRead,
    },
];

fn actor() -> ExecutionContext {
    ExecutionContext::new(Actor::System, "param-test")
}

fn cache_config() -> CacheConfig {
    CacheConfig {
        connection: CacheConnection::Local,
        key_prefix: format!("param-test-{}", Id::new()),
        local_capacity: DEFAULT_LOCAL_CAPACITY.try_into().unwrap(),
    }
}

#[tokio::test]
async fn param_transaction_reads_work_when_all_pool_connections_are_held() {
    test_support::run(async |test| {
        let store = setup(test).await;
        let mut tx = test.db.begin().await.unwrap();
        let mut connections = Vec::new();
        let mut transactions = Vec::new();
        for _ in 0..3 {
            if test.db.dialect() == crate::db::migrate::Dialect::Sqlite {
                connections.push(test.sqlite_pool().acquire().await.unwrap());
            } else {
                transactions.push(test.db.begin().await.unwrap());
            }
        }
        let value = tokio::time::timeout(Duration::from_secs(2), store.int_in(&mut tx, "test.int"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(value, 3);
        assert_eq!(
            store.int_in(&mut tx, "test.text").await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        drop(connections);
        for held in transactions {
            held.rollback().await.unwrap();
        }
        tx.rollback().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn construction_validates_module_declarations_and_duplicate_keys() {
    test_support::run(async |test| {
        let store = setup(test).await;
        let construct = |groups: &[(&str, &[&str], &[ParamDeclaration])]| {
            ParamStore::new(
                test.db.clone(),
                store.0.cache.clone(),
                SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap(),
                groups,
            )
        };
        for declarations in [
            vec![ParamDeclaration {
                key: "invalid",
                ..DECLARATIONS[1]
            }],
            vec![ParamDeclaration {
                key: "test.invalid key",
                ..DECLARATIONS[1]
            }],
            vec![ParamDeclaration {
                group: "other.settings",
                ..DECLARATIONS[1]
            }],
            vec![ParamDeclaration {
                order: -1,
                ..DECLARATIONS[1]
            }],
            vec![ParamDeclaration {
                default: "9",
                ..DECLARATIONS[1]
            }],
            vec![ParamDeclaration {
                read_permission: Some("test.read"),
                ..DECLARATIONS[1]
            }],
            vec![ParamDeclaration {
                write_permission: Some("test.write"),
                ..DECLARATIONS[1]
            }],
            vec![DECLARATIONS[1], DECLARATIONS[1]],
        ] {
            assert_eq!(
                construct(&[("test", &[], &declarations)])
                    .err()
                    .unwrap()
                    .code(),
                INTERNAL_UNEXPECTED
            );
        }
        assert!(construct(&[("other", &[], DECLARATIONS)]).is_err());
        for (module, key, group) in [
            ("", ".int", ".settings"),
            ("Upper", "Upper.int", "Upper.settings"),
            ("a.b", "a.b.int", "a.b.settings"),
        ] {
            assert!(
                construct(&[(
                    module,
                    &[],
                    &[ParamDeclaration {
                        key,
                        group,
                        ..DECLARATIONS[1]
                    }]
                )])
                .is_err()
            );
        }
        let declaration = ParamDeclaration {
            read_permission: Some("test.read"),
            write_permission: Some("test.write"),
            ..DECLARATIONS[1]
        };
        let valid = construct(&[("test", &["test.read", "test.write"], &[declaration])]).unwrap();
        assert_eq!(valid.entries().await.unwrap()[0].module_id, "test");
    })
    .await;
}

#[tokio::test]
async fn bool_in_reads_defaults_and_rows_and_propagates_contract_errors() {
    test_support::run(async |test| {
        let store = setup(test).await;
        let mut tx = test.db.begin().await.unwrap();
        assert!(!store.bool_in(&mut tx, "test.bool").await.unwrap());
        for key in ["test.int", "test.missing"] {
            assert_eq!(
                store.bool_in(&mut tx, key).await.unwrap_err().code(),
                INTERNAL_UNEXPECTED
            );
        }
        tx.rollback().await.unwrap();
        store
            .set(&actor(), "test.bool", "true", None)
            .await
            .unwrap();
        let mut tx = test.db.begin().await.unwrap();
        assert!(store.bool_in(&mut tx, "test.bool").await.unwrap());
        assert!(store.bool_in(&mut tx, "test.bool").await.unwrap());
        tx.rollback().await.unwrap();
        store
            .set(&actor(), "test.bool", "false", Some(1))
            .await
            .unwrap();
        let mut tx = test.db.begin().await.unwrap();
        assert!(!store.bool_in(&mut tx, "test.bool").await.unwrap());
        tx.rollback().await.unwrap();
        raw_value(&store, "test.bool", Some("yes")).await;
        store.0.cache.delete(NS, "test.bool").await.unwrap();
        let mut tx = test.db.begin().await.unwrap();
        assert_eq!(
            store
                .bool_in(&mut tx, "test.bool")
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        tx.rollback().await.unwrap();
    })
    .await;
}

async fn setup(test: &TestDb) -> ParamStore {
    test.upgrade(crate::migrations::MIGRATIONS, 1)
        .await
        .unwrap();
    let secrets =
        SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
    let cache = Cache::connect(&cache_config(), &secrets).await.unwrap();
    ParamStore::new(
        test.db.clone(),
        cache,
        secrets,
        &[("test", &[], DECLARATIONS)],
    )
    .unwrap()
}

async fn raw_value(store: &ParamStore, key: &str, value: Option<&str>) {
    store
        .0
        .db
        .execute(
            &Query::update()
                .table(TABLE.name)
                .value("value", value)
                .and_where(Expr::col("param_key").eq(key))
                .to_owned(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn param_db_versions_defaults_and_reset_conflicts() {
    test_support::run(async |test| {
        let store = setup(test).await;
        let context = actor();
        let (left, right) = tokio::join!(
            store.set(&context, "test.int", "3", None),
            store.set(&context, "test.int", "3", None),
        );
        assert_eq!(
            [&left, &right]
                .iter()
                .filter(|result| result.is_ok())
                .count(),
            1
        );
        assert_eq!(
            [left, right]
                .into_iter()
                .find_map(Result::err)
                .unwrap()
                .code(),
            DATA_VERSION_CONFLICT
        );
        let entries = store.entries().await.unwrap();
        let entry = entries
            .iter()
            .find(|entry| entry.key == "test.int")
            .unwrap();
        assert!(entry.is_default);
        assert_eq!(entry.source, ParamSource::Database);
        assert_eq!(entry.row_version, Some(1));
        assert_eq!(entry.group, "test.settings");
        assert_eq!(store.declarations().count(), DECLARATIONS.len());
        store.set(&context, "test.int", "4", Some(1)).await.unwrap();
        assert_eq!(
            store
                .set(&context, "test.int", "5", Some(1))
                .await
                .unwrap_err()
                .code(),
            DATA_VERSION_CONFLICT
        );
        assert_eq!(
            store.reset("test.int", Some(1)).await.unwrap_err().code(),
            DATA_VERSION_CONFLICT
        );
        store.set(&context, "test.int", "3", Some(2)).await.unwrap();
        store.reset("test.int", Some(3)).await.unwrap();
        assert_eq!(
            store.reset("test.int", Some(3)).await.unwrap_err().code(),
            DATA_VERSION_CONFLICT
        );
        store.reset("test.int", None).await.unwrap();
        let entries = store.entries().await.unwrap();
        let entry = entries
            .iter()
            .find(|entry| entry.key == "test.int")
            .unwrap();
        assert!(entry.is_default);
        assert_eq!(entry.source, ParamSource::Default);
        assert_eq!(entry.row_version, None);
        store.set(&context, "test.int", "4", None).await.unwrap();
        raw_value(&store, "test.int", None).await;
        let entries = store.entries().await.unwrap();
        let entry = entries
            .iter()
            .find(|entry| entry.key == "test.int")
            .unwrap();
        assert_eq!(entry.source, ParamSource::Default);
        assert_eq!(entry.row_version, Some(1));
    })
    .await;
}

#[tokio::test]
async fn param_db_secret_and_cache_failure() {
    test_support::run(async |test| {
        let store = setup(test).await;
        store
            .set(&actor(), "test.secret", "test-password", None)
            .await
            .unwrap();
        let entries = store.entries().await.unwrap();
        let secret = entries
            .iter()
            .find(|entry| entry.key == "test.secret")
            .unwrap();
        assert!(secret.value.is_none() && secret.default.is_none());
        assert_eq!(secret.source, ParamSource::Database);
        assert!(
            !serde_json::to_string(&entries)
                .unwrap()
                .contains("test-password")
        );
        assert!(!format!("{entries:?}").contains("test-password"));
        store.reset("test.secret", Some(1)).await.unwrap();
        let entries = store.entries().await.unwrap();
        assert_eq!(
            entries
                .iter()
                .find(|entry| entry.key == "test.secret")
                .unwrap()
                .source,
            ParamSource::Default
        );

        // 仅在内部测试绕过构造校验，覆盖提交后的真实 cache.delete 失败路径。
        let failing = ParamStore(Arc::new(Inner {
            db: test.db.clone(),
            cache: store.0.cache.clone(),
            secrets: SecretStore::with_backend(test.root.path(), MemoryCredentials::default())
                .unwrap()
                .boxed(),
            declarations: BTreeMap::from([(
                "test.invalid key",
                (
                    "test".into(),
                    ParamDeclaration {
                        key: "test.invalid key",
                        ..DECLARATIONS[1]
                    },
                ),
            )]),
        }));
        assert_eq!(
            failing
                .set(&actor(), "test.invalid key", "4", None)
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        let entries = failing.entries().await.unwrap();
        assert_eq!(entries[0].value.as_deref(), Some("4"));
        assert_eq!(entries[0].row_version, Some(1));
        assert_eq!(entries[0].source, ParamSource::Database);
        assert_eq!(
            failing
                .reset("test.invalid key", Some(1))
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        let entries = failing.entries().await.unwrap();
        assert_eq!(entries[0].row_version, None);
        assert_eq!(entries[0].source, ParamSource::Default);
    })
    .await;
}

#[tokio::test]
async fn defaults_typed_values_versions_reset_and_audit() {
    test_support::run(async |test| {
        let store = setup(test).await;
        assert_eq!(store.text("test.text").await.unwrap(), "初始");
        assert_eq!(store.int("test.int").await.unwrap(), 3);
        assert!(!store.bool("test.bool").await.unwrap());
        assert_eq!(store.choice("test.choice").await.unwrap(), "first");
        assert!(store.secret("test.secret").await.unwrap().is_none());
        for (key, value) in [
            ("test.text", "四个字符"),
            ("test.int", "-2"),
            ("test.bool", "true"),
            ("test.choice", "second"),
        ] {
            store.set(&actor(), key, value, None).await.unwrap();
            for version in [None, Some(0), Some(2)] {
                assert_eq!(
                    store
                        .set(&actor(), key, value, version)
                        .await
                        .unwrap_err()
                        .code(),
                    DATA_VERSION_CONFLICT
                );
                assert_eq!(
                    store.reset(key, version).await.unwrap_err().code(),
                    DATA_VERSION_CONFLICT
                );
            }
        }
        assert_eq!(store.text("test.text").await.unwrap(), "四个字符");
        assert_eq!(store.int("test.int").await.unwrap(), -2);
        assert!(store.bool("test.bool").await.unwrap());
        assert_eq!(store.choice("test.choice").await.unwrap(), "second");
        let user = Id::new();
        store
            .set(
                &ExecutionContext::new(Actor::User(user), "update"),
                "test.int",
                "8",
                Some(1),
            )
            .await
            .unwrap();
        assert_eq!(store.int("test.int").await.unwrap(), 8);
        let row: (String, String, i64) = test
            .db
            .fetch_optional(
                &Query::select()
                    .columns(["created_by", "updated_by", "row_version"])
                    .from(TABLE.name)
                    .and_where(Expr::col("param_key").eq("test.int"))
                    .to_owned(),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row, ("system".into(), user.to_string(), 2));
        store.reset("test.int", Some(2)).await.unwrap();
        assert_eq!(
            store.reset("test.int", Some(999)).await.unwrap_err().code(),
            DATA_VERSION_CONFLICT
        );
        store.reset("test.int", None).await.unwrap();
        assert_eq!(store.int("test.int").await.unwrap(), 3);
        assert_eq!(
            store
                .set(&actor(), "test.int", "1", Some(2))
                .await
                .unwrap_err()
                .code(),
            DATA_VERSION_CONFLICT
        );
        let entries = store.entries().await.unwrap();
        assert_eq!(
            entries.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(),
            [
                "test.bool",
                "test.choice",
                "test.int",
                "test.secret",
                "test.text"
            ]
        );
        let integer = entries.iter().find(|r| r.key == "test.int").unwrap();
        assert!(integer.is_default);
        assert!(integer.row_version.is_none());
        assert!(integer.updated_at.is_none());
    })
    .await;
}

#[tokio::test]
async fn invalid_inputs_types_unknown_keys_and_corrupt_storage_fail_explicitly() {
    test_support::run(async |test| {
        let store = setup(test).await;
        for (key, value) in [
            ("test.text", "五个字符哦"),
            ("test.text", "a\n"),
            ("test.text", "\u{7f}"),
            ("test.int", "-3"),
            ("test.int", "9"),
            ("test.int", "1.0"),
            ("test.int", " 1"),
            ("test.bool", "True"),
            ("test.bool", "1"),
            ("test.choice", "other"),
            ("test.secret", ""),
        ] {
            let error = store.set(&actor(), key, value, None).await.unwrap_err();
            assert_eq!(error.code(), INPUT_INVALID);
            assert_eq!(error.params.get("path").unwrap(), "value");
        }
        assert_eq!(
            store
                .set(&actor(), "test.secret", &"x".repeat(4097), None)
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        for error in [
            store.text("test.int").await.unwrap_err(),
            store.int("test.text").await.unwrap_err(),
            store.bool("test.choice").await.unwrap_err(),
            store.choice("test.bool").await.unwrap_err(),
            store.secret("test.text").await.unwrap_err(),
            store.text("test.secret").await.unwrap_err(),
            store.int("test.missing").await.unwrap_err(),
            store
                .set(&actor(), "test.missing", "x", None)
                .await
                .unwrap_err(),
            store.reset("test.missing", None).await.unwrap_err(),
        ] {
            assert_eq!(error.code(), INTERNAL_UNEXPECTED);
        }
        for (key, value) in [
            ("test.int", "not-integer"),
            ("test.bool", "yes"),
            ("test.text", "bad\t"),
            ("test.choice", "third"),
        ] {
            let default = store.declaration(key).unwrap().default;
            store.set(&actor(), key, default, None).await.unwrap();
            raw_value(&store, key, Some(value)).await;
            assert_eq!(
                store
                    .value(store.declaration(key).unwrap(), None)
                    .await
                    .unwrap_err()
                    .code(),
                INTERNAL_UNEXPECTED
            );
            assert!(store.entries().await.is_err());
            store.reset(key, Some(1)).await.unwrap();
        }
        store.set(&actor(), "test.int", "8", None).await.unwrap();
        raw_value(&store, "test.int", None).await;
        assert_eq!(store.int("test.int").await.unwrap(), 3);
    })
    .await;
}

#[tokio::test]
async fn cache_ttl_hits_invalidation_and_errors() {
    test_support::run(async |test| {
        let store = setup(test).await;
        store.set(&actor(), "test.int", "4", None).await.unwrap();
        assert_eq!(store.int("test.int").await.unwrap(), 4);
        assert_eq!(
            store
                .0
                .cache
                .get_json::<String>(NS, "test.int")
                .await
                .unwrap()
                .as_deref(),
            Some("4")
        );
        raw_value(&store, "test.int", Some("7")).await;
        assert_eq!(store.int("test.int").await.unwrap(), 4);
        assert_eq!(
            store
                .entries()
                .await
                .unwrap()
                .iter()
                .find(|r| r.key == "test.int")
                .unwrap()
                .value
                .as_deref(),
            Some("7")
        );
        tokio::time::sleep(Duration::from_secs(60) + Duration::from_millis(50)).await;
        assert_eq!(store.int("test.int").await.unwrap(), 7);
        store.set(&actor(), "test.int", "8", Some(1)).await.unwrap();
        assert_eq!(store.int("test.int").await.unwrap(), 8);
        store.reset("test.int", Some(2)).await.unwrap();
        assert_eq!(store.int("test.int").await.unwrap(), 3);
        store
            .0
            .cache
            .set(NS, "test.int", b"invalid-json", TTL)
            .await
            .unwrap();
        assert_eq!(
            store.int("test.int").await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        store
            .0
            .cache
            .set_json(NS, "test.int", "bad-integer", TTL)
            .await
            .unwrap();
        assert_eq!(
            store.int("test.int").await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
    })
    .await;
}

#[tokio::test]
async fn concurrent_first_write_has_one_winner_and_unique_conflicts_are_version_conflicts() {
    test_support::run(async |test| {
        let store = setup(test).await;
        let actor = actor();
        let (left, right) = tokio::join!(
            store.set(&actor, "test.int", "4", None),
            store.set(&actor, "test.int", "5", None)
        );
        let results = [left, right];
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            results.into_iter().find_map(Result::err).unwrap().code(),
            DATA_VERSION_CONFLICT
        );
        let mut tx = test.db.begin().await.unwrap();
        let error = tx
            .insert(
                TABLE,
                &actor,
                [
                    ("param_key", "test.int".into()),
                    ("secret_set", false.into()),
                ],
            )
            .await
            .unwrap_err();
        assert_eq!(write_error(error).code(), DATA_VERSION_CONFLICT);
        tx.rollback().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn secrets_never_enter_rows_cache_or_lists_and_reset_removes_credentials() {
    test_support::run(async |test| {
        let store = setup(test).await;
        store
            .set(&actor(), "test.secret", "synthetic-secret", None)
            .await
            .unwrap();
        assert_eq!(
            store
                .secret("test.secret")
                .await
                .unwrap()
                .unwrap()
                .expose_secret(),
            "synthetic-secret"
        );
        let row: Record = test.db.fetch_optional(&query()).await.unwrap().unwrap();
        assert!(row.value.is_none());
        assert!(row.secret_set);
        assert!(
            store
                .0
                .cache
                .get(NS, "test.secret")
                .await
                .unwrap()
                .is_none()
        );
        test.db
            .insert(
                TABLE,
                &actor(),
                [
                    ("param_key", "removed.old".into()),
                    ("value", "ignored".into()),
                    ("secret_set", false.into()),
                ],
            )
            .await
            .unwrap();
        let entries = store.entries().await.unwrap();
        assert_eq!(entries.len(), DECLARATIONS.len());
        let secret = entries.iter().find(|r| r.key == "test.secret").unwrap();
        assert!(
            secret.value.is_none()
                && secret.default.is_none()
                && secret.secret_set
                && !secret.is_default
        );
        assert!(
            !serde_json::to_string(&entries)
                .unwrap()
                .contains("synthetic-secret")
        );
        assert!(!format!("{entries:?}").contains("synthetic-secret"));
        store.reset("test.secret", Some(1)).await.unwrap();
        assert!(store.secret("test.secret").await.unwrap().is_none());
        assert_eq!(
            store
                .0
                .secrets
                .get_stored("param.test.secret")
                .unwrap_err()
                .code(),
            SECRET_NOT_FOUND
        );
    })
    .await;
}

#[tokio::test]
async fn secret_changes_compensate_database_failure_for_create_update_and_reset() {
    test_support::run(async |test| {
        let store = setup(test).await;
        for old in [None, Some("original")] {
            for new in [None, Some("replacement")] {
                if let Some(old) = old {
                    store
                        .0
                        .secrets
                        .set("param.test.secret", &old.into())
                        .unwrap();
                }
                let change = SecretChange::apply(
                    &store.0.secrets,
                    "test.secret",
                    new.map(SecretString::from).as_ref(),
                )
                .unwrap();
                let mut tx = test.db.begin().await.unwrap();
                // 真正的 SQL 失败进入与提交失败共用的补偿路径。
                let failed = tx
                    .insert(TABLE, &actor(), [("unknown_column", "invalid".into())])
                    .await
                    .map(|_| ());
                tx.rollback().await.unwrap();
                assert!(complete(failed, Some(change)).is_err());
                match old {
                    Some(old) => {
                        assert_eq!(
                            store
                                .0
                                .secrets
                                .get_stored("param.test.secret")
                                .unwrap()
                                .expose_secret(),
                            old
                        );
                        store.0.secrets.delete("param.test.secret").unwrap();
                    }
                    None => assert_eq!(
                        store
                            .0
                            .secrets
                            .get_stored("param.test.secret")
                            .unwrap_err()
                            .code(),
                        SECRET_NOT_FOUND
                    ),
                }
            }
        }
    })
    .await;
}

struct FailingCredentials {
    memory: MemoryCredentials,
    fail: Arc<AtomicBool>,
}

#[test]
fn secret_compensation_failure_is_visible_and_does_not_expose_values() {
    let root = tempfile::tempdir().unwrap();
    for old in [None, Some("previous-secret")] {
        let fail = Arc::new(AtomicBool::new(false));
        let secrets = SecretStore::with_backend(
            root.path(),
            FailingCredentials {
                memory: MemoryCredentials::default(),
                fail: fail.clone(),
            },
        )
        .unwrap()
        .boxed();
        if let Some(old) = old {
            secrets.set("param.test.secret", &old.into()).unwrap();
        }
        let change =
            SecretChange::apply(&secrets, "test.secret", Some(&"replacement-secret".into()))
                .unwrap();
        fail.store(true, Ordering::SeqCst);
        let error = complete(Err(internal()), Some(change)).unwrap_err();
        assert_eq!(error.code(), SECRET_UNAVAILABLE);
        let rendered = format!("{error:?}");
        assert!(!rendered.contains("previous-secret"));
        assert!(!rendered.contains("replacement-secret"));
    }
}
impl CredentialBackend for FailingCredentials {
    fn get(&self, account: &str) -> Result<SecretString, CredentialError> {
        self.memory.get(account)
    }
    fn set(&self, account: &str, value: &SecretString) -> Result<(), CredentialError> {
        if self.fail.load(Ordering::SeqCst) {
            Err(CredentialError::Unavailable)
        } else {
            self.memory.set(account, value)
        }
    }
    fn delete(&self, account: &str) -> Result<(), CredentialError> {
        if self.fail.load(Ordering::SeqCst) {
            Err(CredentialError::Unavailable)
        } else {
            self.memory.delete(account)
        }
    }
}

#[tokio::test]
async fn credential_failure_rolls_back_sql_changes() {
    test_support::run(async |test| {
        let initial = setup(test).await;
        let fail = Arc::new(AtomicBool::new(true));
        let store = ParamStore::new(
            test.db.clone(),
            initial.0.cache.clone(),
            SecretStore::with_backend(
                test.root.path(),
                FailingCredentials {
                    memory: MemoryCredentials::default(),
                    fail: fail.clone(),
                },
            )
            .unwrap(),
            &[("test", &[], DECLARATIONS)],
        )
        .unwrap();
        assert_eq!(
            store
                .set(&actor(), "test.secret", "new", None)
                .await
                .unwrap_err()
                .code(),
            SECRET_UNAVAILABLE
        );
        assert!(test.rows::<(Id,)>(TABLE.name, &["id"]).await.is_empty());
        fail.store(false, Ordering::SeqCst);
        store
            .set(&actor(), "test.secret", "old", None)
            .await
            .unwrap();
        fail.store(true, Ordering::SeqCst);
        assert_eq!(
            store
                .reset("test.secret", Some(1))
                .await
                .unwrap_err()
                .code(),
            SECRET_UNAVAILABLE
        );
        assert_eq!(
            store
                .secret("test.secret")
                .await
                .unwrap()
                .unwrap()
                .expose_secret(),
            "old"
        );
        assert_eq!(
            test.rows::<(i64,)>(TABLE.name, &["row_version"]).await,
            [(1,)]
        );
    })
    .await;
}

#[tokio::test]
async fn param_migrated_schema_matches_sqlite() {
    test_support::assert_migrated_schema(crate::migrations::MIGRATIONS).await;
}
