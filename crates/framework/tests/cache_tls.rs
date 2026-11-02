#![cfg(test)]

use secrecy::{ExposeSecret, SecretString};
use tenon_framework::{
    cache::{
        CACHE_UNAVAILABLE, Cache, CacheConfig, CacheConnection, DEFAULT_LOCAL_CAPACITY, RedisConfig,
    },
    network::TlsMode,
    secret::{CredentialBackend, CredentialError, SecretStore},
};

struct NoSystemCredentials;
impl CredentialBackend for NoSystemCredentials {
    fn get(&self, _: &str) -> Result<SecretString, CredentialError> {
        panic!("TLS test requires an environment secret")
    }
    fn set(&self, _: &str, _: &SecretString) -> Result<(), CredentialError> {
        panic!("must not write credentials")
    }
    fn delete(&self, _: &str) -> Result<(), CredentialError> {
        panic!("must not delete credentials")
    }
}

#[tokio::test]
#[ignore = "维护者配置 TENON_TEST_REDIS_* 后显式运行 Redis TLS 测试"]
async fn redis_tls_modes_and_untrusted_ca_via_config_and_secrets() {
    assert_eq!(std::env::var("TENON_TEST_CACHE_TLS").as_deref(), Ok("1"));
    let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
    let store = SecretStore::with_backend(root.path(), NoSystemCredentials).unwrap();
    let password = SecretString::from(
        std::env::var("TENON_SECRET__CACHE__REDIS_PASSWORD").expect("missing test secret"),
    );
    assert!(
        !password.expose_secret().is_empty(),
        "TLS test requires a password"
    );
    let correct = std::env::var("TENON_TEST_REDIS_CA_FILE").unwrap();
    let wrong = std::env::var("TENON_TEST_REDIS_WRONG_CA_FILE").unwrap();
    assert_ne!(
        std::fs::read(&correct).unwrap(),
        std::fs::read(&wrong).unwrap(),
        "negative test requires an unrelated CA"
    );
    for (mode, ca, succeeds) in [
        (TlsMode::Disabled, None, true),
        (TlsMode::VerifyCa, Some(&correct), true),
        (TlsMode::VerifyFull, Some(&correct), false),
        (TlsMode::VerifyCa, Some(&wrong), false),
    ] {
        let port_key = if ca.is_some() {
            "TENON_TEST_REDIS_TLS_PORT"
        } else {
            "TENON_TEST_REDIS_PORT"
        };
        let config = CacheConfig {
            connection: CacheConnection::Redis(RedisConfig {
                host: std::env::var("TENON_TEST_REDIS_HOST").unwrap(),
                port: std::env::var(port_key).unwrap().parse().unwrap(),
                db: std::env::var("TENON_TEST_REDIS_DB")
                    .map(|value| value.parse().unwrap())
                    .unwrap_or(0),
                username: std::env::var("TENON_TEST_REDIS_USERNAME").ok(),
                password_secret: "cache.redis_password".into(),
                tls: mode,
                tls_ca_file: ca.map(std::path::PathBuf::from),
            }),
            key_prefix: format!("tls-test-{}", uuid::Uuid::new_v4()),
            local_capacity: DEFAULT_LOCAL_CAPACITY.try_into().unwrap(),
        };
        let result = Cache::connect(&config, &store).await;
        assert!(
            !format!("{config:?} {result:?}").contains(password.expose_secret()),
            "secret leaked"
        );
        if succeeds {
            result.unwrap().ping().await.unwrap();
            println!("redis {mode:?}: connected");
        } else {
            let error = result.expect_err("certificate validation must reject this connection");
            assert_eq!(error.code(), CACHE_UNAVAILABLE);
            println!(
                "redis {mode:?}: rejected {} ({})",
                if ca == Some(&wrong) {
                    "untrusted CA"
                } else {
                    "mismatched hostname"
                },
                error.code()
            );
        }
    }
}
