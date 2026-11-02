use super::*;
use crate::secret::CredentialError;
use secrecy::SecretString;

struct NoCredentials;
impl CredentialBackend for NoCredentials {
    fn get(&self, _: &str) -> Result<SecretString, CredentialError> {
        panic!("cache test requires environment secret")
    }
    fn set(&self, _: &str, _: &SecretString) -> Result<(), CredentialError> {
        panic!("must not write credentials")
    }
    fn delete(&self, _: &str) -> Result<(), CredentialError> {
        panic!("must not delete credentials")
    }
}

async fn cache() -> Cache {
    let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
    let provider = std::env::var("TENON_TEST_CACHE_PROVIDER").unwrap_or_else(|_| "local".into());
    assert!(["local", "redis"].contains(&provider.as_str()));
    let connection = if provider == "redis" {
        CacheConnection::Redis(RedisConfig {
            host: std::env::var("TENON_TEST_REDIS_HOST").unwrap(),
            port: std::env::var("TENON_TEST_REDIS_PORT")
                .unwrap()
                .parse()
                .unwrap(),
            db: std::env::var("TENON_TEST_REDIS_DB")
                .map(|value| value.parse().unwrap())
                .unwrap_or(0),
            username: std::env::var("TENON_TEST_REDIS_USERNAME").ok(),
            password_secret: "cache.redis_password".into(),
            tls: std::env::var("TENON_TEST_REDIS_TLS")
                .map(|value| serde_json::from_value(serde_json::Value::String(value)).unwrap())
                .unwrap_or_default(),
            tls_ca_file: std::env::var_os("TENON_TEST_REDIS_CA_FILE").map(PathBuf::from),
        })
    } else {
        CacheConnection::Local
    };
    let config = CacheConfig {
        connection,
        key_prefix: format!("test-{}", Uuid::new_v4()),
        local_capacity: DEFAULT_LOCAL_CAPACITY.try_into().unwrap(),
    };
    Cache::connect(
        &config,
        &SecretStore::with_backend(root.path(), NoCredentials).unwrap(),
    )
    .await
    .unwrap()
}

const TTL: Duration = Duration::from_secs(5);
const SHORT: Duration = Duration::from_millis(80);

#[tokio::test]
async fn contract_values_ttl_delete_and_json() {
    let cache = cache().await;
    cache.ping().await.unwrap();
    assert_eq!(cache.get("items", "missing").await.unwrap(), None);
    cache
        .set("items", "bytes", &[0, 255, 1], TTL)
        .await
        .unwrap();
    assert_eq!(
        cache.get("items", "bytes").await.unwrap(),
        Some(vec![0, 255, 1])
    );
    cache.delete("items", "bytes").await.unwrap();
    cache.delete("items", "bytes").await.unwrap();
    assert_eq!(cache.get("items", "bytes").await.unwrap(), None);
    cache.set("items", "ttl", b"old", TTL).await.unwrap();
    cache.set("items", "ttl", b"new", SHORT).await.unwrap();
    tokio::time::sleep(Duration::from_millis(160)).await;
    assert_eq!(cache.get("items", "ttl").await.unwrap(), None);
    let json = serde_json::json!({"text":"中文", "bytes":[0,255]});
    cache.set_json("items", "json", &json, TTL).await.unwrap();
    assert_eq!(
        cache
            .get_json::<serde_json::Value>("items", "json")
            .await
            .unwrap(),
        Some(json)
    );
    cache
        .set("items", "bad-json", b"secret-value-invalid-json", TTL)
        .await
        .unwrap();
    let error = cache
        .get_json::<serde_json::Value>("items", "bad-json")
        .await
        .unwrap_err();
    assert_eq!(error.code(), INTERNAL_UNEXPECTED);
    assert!(!format!("{error:?}").contains("secret-value"));
}

#[tokio::test]
async fn contract_namespace_and_prefix_isolation() {
    let cache = cache().await;
    // 共享同一后端，确保本机测试真正验证前缀编码，而非两个独立缓存。
    let other = Cache {
        prefix: format!("{}-other", cache.prefix),
        backend: cache.backend.clone(),
    };
    cache.set("a", "key", b"first", TTL).await.unwrap();
    cache.set("b", "key", b"second", TTL).await.unwrap();
    assert_eq!(other.get("a", "key").await.unwrap(), None);
    other.set("a", "key", b"isolated", TTL).await.unwrap();
    assert_eq!(
        cache.get("a", "key").await.unwrap(),
        Some(b"first".to_vec())
    );
    assert_eq!(
        cache.get("b", "key").await.unwrap(),
        Some(b"second".to_vec())
    );
    assert_eq!(
        other.get("a", "key").await.unwrap(),
        Some(b"isolated".to_vec())
    );
    cache.set("a", "key", b"new", TTL).await.unwrap();
    assert_eq!(cache.get("a", "key").await.unwrap(), Some(b"new".to_vec()));
}

#[tokio::test]
async fn contract_rejects_invalid_names_and_ttls() {
    let cache = cache().await;
    for invalid in [
        "",
        "UPPER",
        "a:b",
        "with space",
        "中文",
        "bad\0name",
        "@lock",
    ] {
        for result in [
            cache.get(invalid, "key").await,
            cache.get("ns", invalid).await,
        ] {
            assert_eq!(result.unwrap_err().code(), INTERNAL_UNEXPECTED);
        }
        assert_eq!(
            cache
                .set("ns", invalid, b"x", TTL)
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            cache.delete(invalid, "key").await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            cache.try_lock(invalid, TTL).await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
    }
    for ttl in [Duration::ZERO, Duration::from_nanos(1), Duration::MAX] {
        assert_eq!(
            cache.set("ns", "key", b"x", ttl).await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            cache.try_lock("lock", ttl).await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
    }
}

#[tokio::test]
async fn contract_lock_token_expiry_and_explicit_release() {
    let cache = cache().await;
    let (first, second) = tokio::join!(
        cache.try_lock("contended", TTL),
        cache.try_lock("contended", TTL)
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert_ne!(first.is_some(), second.is_some());
    let guard = first.or(second).unwrap();
    let wrong = LockGuard {
        backend: guard.backend.clone(),
        key: guard.key.clone(),
        token: Uuid::new_v4(),
    };
    wrong.release().await.unwrap();
    assert!(cache.try_lock("contended", TTL).await.unwrap().is_none());
    assert!(!format!("{guard:?}").contains(&guard.token.to_string()));
    guard.release().await.unwrap();
    guard.release().await.unwrap();
    cache
        .try_lock("contended", TTL)
        .await
        .unwrap()
        .unwrap()
        .release()
        .await
        .unwrap();
    let old = cache.try_lock("lease", SHORT).await.unwrap().unwrap();
    tokio::time::sleep(Duration::from_millis(160)).await;
    let new = cache.try_lock("lease", TTL).await.unwrap().unwrap();
    old.release().await.unwrap();
    assert!(cache.try_lock("lease", TTL).await.unwrap().is_none());
    new.release().await.unwrap();
    drop(cache.try_lock("drop", SHORT).await.unwrap().unwrap());
    assert!(cache.try_lock("drop", TTL).await.unwrap().is_none());
    tokio::time::sleep(Duration::from_millis(160)).await;
    cache
        .try_lock("drop", TTL)
        .await
        .unwrap()
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[tokio::test]
async fn local_capacity_does_not_evict_locks() {
    let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
    let config = CacheConfig {
        local_capacity: std::num::NonZeroU64::new(1).unwrap(),
        connection: CacheConnection::Local,
        key_prefix: "capacity-test".into(),
    };
    let cache = Cache::connect(
        &config,
        &SecretStore::with_backend(root.path(), NoCredentials).unwrap(),
    )
    .await
    .unwrap();
    let lock = cache.try_lock("capacity", TTL).await.unwrap().unwrap();
    for i in 0..100 {
        cache
            .set("ns", &format!("key{i}"), b"value", TTL)
            .await
            .unwrap();
    }
    let Backend::Local(local) = &cache.backend else {
        panic!()
    };
    local.values.run_pending_tasks().await;
    assert!(local.values.entry_count() <= 1);
    assert!(cache.try_lock("capacity", TTL).await.unwrap().is_none());
    lock.release().await.unwrap();
}

#[tokio::test]
async fn poisoned_local_locks_return_internal_errors() {
    let root = tempfile::tempdir().unwrap();
    let config = CacheConfig {
        connection: CacheConnection::Local,
        key_prefix: "poison-test".into(),
        local_capacity: DEFAULT_LOCAL_CAPACITY.try_into().unwrap(),
    };
    let cache = Cache::connect(
        &config,
        &SecretStore::with_backend(root.path(), NoCredentials).unwrap(),
    )
    .await
    .unwrap();
    let guard = cache.try_lock("held", TTL).await.unwrap().unwrap();
    let Backend::Local(local) = &cache.backend else {
        panic!("expected local backend")
    };
    let local = Arc::clone(local);
    assert!(
        std::thread::spawn(move || {
            let _guard = local.locks.lock().unwrap();
            panic!("poison lease lock");
        })
        .join()
        .is_err()
    );
    assert_eq!(
        cache.try_lock("next", TTL).await.unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    assert_eq!(
        guard.release().await.unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    drop(guard);
}

#[test]
fn cache_dictionary_preserves_connection_status_contract() {
    assert_eq!(DICTIONARIES.len(), 1);
    let declaration = &DICTIONARIES[0];
    assert_eq!(declaration.code, "framework.cache_status");
    assert_eq!(declaration.items, CacheConnectionStatus::ITEMS);
    assert_eq!(declaration.items[0].tone, crate::dict::DictTone::Success);
    assert_eq!(declaration.items[1].tone, crate::dict::DictTone::Danger);
    assert_eq!(
        declaration
            .items
            .iter()
            .map(|item| item.value)
            .collect::<Vec<_>>(),
        ["connected", "error"]
    );
}
