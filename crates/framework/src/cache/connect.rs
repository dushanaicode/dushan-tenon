use std::{fmt, fs, time::Duration};

use redis::{
    Client, ConnectionAddr, IntoConnectionInfo, RedisConnectionInfo, TlsCertificates,
    aio::{ConnectionManager, ConnectionManagerConfig},
};
use secrecy::{ExposeSecret, SecretString};

use crate::{
    cache::{CACHE_UNAVAILABLE, RedisConfig},
    error::AppError,
    network::TlsMode,
    secret::{CredentialBackend, SecretStore},
};

// redis 未公开读取 hostname 开关的 API；纯映射供单元测试核对三档语义。
#[derive(Debug, PartialEq, Eq)]
struct TlsPolicy {
    encrypted: bool,
    accept_invalid_hostnames: bool,
}

fn tls_policy(mode: TlsMode) -> TlsPolicy {
    TlsPolicy {
        encrypted: mode != TlsMode::Disabled,
        accept_invalid_hostnames: mode == TlsMode::VerifyCa,
    }
}

struct Options(Client);

impl fmt::Debug for Options {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RedisOptions").finish_non_exhaustive()
    }
}

impl Options {
    fn new(config: &RedisConfig, password: &SecretString) -> Result<Self, AppError> {
        let policy = tls_policy(config.tls);
        let addr = if policy.encrypted {
            ConnectionAddr::TcpTls {
                host: config.host.clone(),
                port: config.port.get(),
                // 永远验证证书链；严禁设为 true，也不接受 URL 的 #insecure 路径。
                insecure: false,
                tls_params: None,
            }
        } else {
            ConnectionAddr::Tcp(config.host.clone(), config.port.get())
        };
        let mut redis = RedisConnectionInfo::default()
            .set_db(i64::from(config.db))
            .set_password(password.expose_secret());
        if let Some(username) = &config.username {
            redis = redis.set_username(username);
        }
        let mut info = addr
            .into_connection_info()
            .map_err(|_| unavailable())?
            .set_redis_settings(redis);
        if policy.encrypted
            && let Some(path) = &config.tls_ca_file
        {
            let root_cert = fs::read(path).map_err(|_| unavailable())?;
            // build_with_tls 会重建 TLS 参数并重置 hostname 开关，所以必须先加载 CA。
            info = Client::build_with_tls(
                info,
                TlsCertificates {
                    client_tls: None,
                    root_cert: Some(root_cert),
                },
            )
            .map_err(|_| unavailable())?
            .get_connection_info()
            .clone();
        }
        if policy.accept_invalid_hostnames {
            let mut addr = info.addr().clone();
            addr.set_danger_accept_invalid_hostnames(true);
            info = info.set_addr(addr);
        }
        Client::open(info).map(Self).map_err(|_| unavailable())
    }
}

pub(super) async fn connect(
    config: &RedisConfig,
    secrets: &SecretStore<impl CredentialBackend>,
) -> Result<ConnectionManager, AppError> {
    let password = secrets.get(&config.password_secret)?;
    let options = Options::new(config, &password)?;
    ConnectionManager::new_with_config(
        options.0,
        ConnectionManagerConfig::new()
            .set_number_of_retries(0)
            .set_connection_timeout(Some(Duration::from_secs(3)))
            .set_response_timeout(Some(Duration::from_secs(3))),
    )
    .await
    .map_err(|_| unavailable())
}

pub(super) fn unavailable() -> AppError {
    // 驱动和服务端原始错误可能包含秘密，不保留其文本或 source。
    AppError::new(CACHE_UNAVAILABLE).with_source(std::io::Error::other(
        "Redis 不可用，请核对地址、SecretStore 与 TLS 证书配置",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        cache::{Cache, CacheConfig, CacheConnection, DEFAULT_LOCAL_CAPACITY},
        secret::CredentialError,
    };

    const PASSWORD: &str = "secret-cache-fixture-do-not-log";
    struct Memory;
    impl CredentialBackend for Memory {
        fn get(&self, _: &str) -> Result<SecretString, CredentialError> {
            Ok(SecretString::from(PASSWORD))
        }
        fn set(&self, _: &str, _: &SecretString) -> Result<(), CredentialError> {
            panic!()
        }
        fn delete(&self, _: &str) -> Result<(), CredentialError> {
            panic!()
        }
    }

    fn remote(port: u16, tls: TlsMode) -> RedisConfig {
        RedisConfig {
            host: "127.0.0.1".into(),
            port: port.try_into().unwrap(),
            db: 0,
            username: None,
            password_secret: "cache.unit_test_password".into(),
            tls,
            tls_ca_file: None,
        }
    }

    #[test]
    fn tls_modes_never_disable_chain_verification() {
        for (mode, encrypted, hostnames) in [
            (TlsMode::Disabled, false, false),
            (TlsMode::VerifyCa, true, true),
            (TlsMode::VerifyFull, true, false),
        ] {
            assert_eq!(
                tls_policy(mode),
                TlsPolicy {
                    encrypted,
                    accept_invalid_hostnames: hostnames
                }
            );
            let options = Options::new(&remote(6379, mode), &SecretString::from(PASSWORD)).unwrap();
            match options.0.get_connection_info().addr() {
                ConnectionAddr::Tcp(_, _) => assert!(!encrypted),
                ConnectionAddr::TcpTls { insecure, .. } => {
                    assert!(encrypted);
                    assert!(!insecure);
                }
                _ => panic!("unexpected Redis transport"),
            }
            assert!(!format!("{options:?}").contains(PASSWORD));
            assert_eq!(
                options.0.get_connection_info().redis_settings().password(),
                Some(PASSWORD)
            );
        }
    }

    #[tokio::test]
    async fn unreachable_redis_is_an_error_and_never_falls_back() {
        // 保留 TCP 端口但不回应 Redis 握手，确定性验证连接超时。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // TCP 接受但不回应握手，确保超时路径也有上界。
        let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let config = CacheConfig {
            connection: CacheConnection::Redis(remote(port, TlsMode::Disabled)),
            key_prefix: "connection-test".into(),
            local_capacity: DEFAULT_LOCAL_CAPACITY.try_into().unwrap(),
        };
        let result = Cache::connect(
            &config,
            &SecretStore::with_backend(root.path(), Memory).unwrap(),
        )
        .await;
        let error = result.unwrap_err();
        assert_eq!(error.code(), CACHE_UNAVAILABLE);
        assert!(!format!("{error:?} {error}").contains(PASSWORD));
        drop(listener);
    }
}
