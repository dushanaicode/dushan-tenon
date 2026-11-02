//! 已校验的显式代理配置与 TLS 策略；凭据与端点分离，不读取通用代理环境，仅依赖 error、secret。
use std::net::{Ipv4Addr, Ipv6Addr};

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    error::{AppError, ErrorCode},
    secret::{CredentialBackend, SECRET_NOT_FOUND, SecretStore},
};

pub const INVALID_PROXY: ErrorCode = ErrorCode::new("app.network.invalid_proxy");
pub const CREDENTIALS_MISSING: ErrorCode = ErrorCode::new("app.network.credentials_missing");
pub const CREDENTIALS_KEY: &str = "network.proxy_credentials";
pub type ProxySecrets = SecretStore<Box<dyn CredentialBackend + Send + Sync>>;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    #[default]
    Direct,
    Manual,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TlsMode {
    Disabled,
    VerifyCa,
    #[default]
    VerifyFull,
}

/// 端点在构造时校验，私有字段保证读取快照时无需重复验证。
#[derive(Clone, Debug)]
pub struct ProxyConfig {
    mode: ProxyMode,
    endpoint: String,
    auth: bool,
}

impl ProxyConfig {
    pub fn mode(&self) -> ProxyMode {
        self.mode
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn auth(&self) -> bool {
        self.auth
    }

    pub fn new(mode: ProxyMode, endpoint: String, auth: bool) -> Result<Self, AppError> {
        if mode != ProxyMode::Direct || !endpoint.is_empty() {
            validate_endpoint(&endpoint)?;
        }
        Ok(Self {
            mode,
            endpoint,
            auth,
        })
    }
}

/// 无 Debug/Serialize；凭据只在调用 Proxy::basic_auth 时暴露。
pub struct ProxyCredentials {
    pub username: SecretString,
    pub password: SecretString,
}

impl ProxyCredentials {
    pub fn parse(value: &SecretString) -> Result<Self, AppError> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Credentials {
            username: String,
            password: String,
        }
        if value.expose_secret().len() > 32768 {
            return Err(AppError::new(INVALID_PROXY));
        }
        let value: Credentials = serde_json::from_str(value.expose_secret())
            .map_err(|_| AppError::new(INVALID_PROXY))?;
        let value = Self {
            username: value.username.into(),
            password: value.password.into(),
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), AppError> {
        let username = self.username.expose_secret();
        let password = self.password.expose_secret();
        if username.is_empty()
            || username.len() > 1024
            || username.contains(':')
            || password.is_empty()
            || password.len() > 4096
            || username
                .chars()
                .chain(password.chars())
                .any(char::is_control)
        {
            return Err(AppError::new(INVALID_PROXY));
        }
        Ok(())
    }

    pub fn encode(&self) -> Result<SecretString, AppError> {
        // JSON 只作为 SecretStore 的整体值；不作为 DTO 返回或用于日志。
        serde_json::to_string(&serde_json::json!({"username": self.username.expose_secret(), "password": self.password.expose_secret()}))
            .map(SecretString::from).map_err(|_| AppError::new(INVALID_PROXY))
    }
}

pub enum ProxySnapshot {
    Direct,
    Manual {
        endpoint: String,
        credentials: Option<ProxyCredentials>,
    },
}

impl ProxySnapshot {
    /// 调用方持有共享配置锁，覆盖配置和秘密读取，以免与宿主保存交错。
    pub fn read<B: CredentialBackend>(
        config: &ProxyConfig,
        secrets: &SecretStore<B>,
        exact_loopback: bool,
    ) -> Result<Self, AppError> {
        if exact_loopback || config.mode == ProxyMode::Direct {
            return Ok(Self::Direct);
        }
        let credentials = if config.auth {
            let secret = secrets.get(CREDENTIALS_KEY).map_err(|error| {
                if error.code() == SECRET_NOT_FOUND {
                    AppError::new(CREDENTIALS_MISSING)
                } else {
                    error
                }
            })?;
            Some(ProxyCredentials::parse(&secret)?)
        } else {
            None
        };
        Ok(Self::Manual {
            endpoint: config.endpoint.clone(),
            credentials,
        })
    }
}

/// 输入是已通过使用方校验的目标 URL；使用原 authority，不接受 URL 的 IPv4 缩写归一化。
pub fn is_exact_loopback(url: &str) -> bool {
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    let authority = rest
        .split_once(['/', '?', '#'])
        .map_or(rest, |(authority, _)| authority);
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split_once(']').map(|(host, _)| host)
    } else {
        authority.split(':').next()
    };
    matches!(host, Some("localhost" | "127.0.0.1" | "::1"))
}

/// 受限 endpoint 语法；framework 不为此引入 URL/HTTP 依赖。
fn validate_endpoint(endpoint: &str) -> Result<(), AppError> {
    let invalid = || AppError::new(INVALID_PROXY);
    if endpoint.len() > 1024
        || !endpoint.is_ascii()
        || endpoint
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
    {
        return Err(invalid());
    }
    let (scheme, authority) = endpoint.split_once("://").ok_or_else(invalid)?;
    if !matches!(scheme, "http" | "https") || authority.contains(['/', '?', '#', '@', '\\', '%']) {
        return Err(invalid());
    }
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (host, suffix) = rest.split_once(']').ok_or_else(invalid)?;
        host.parse::<Ipv6Addr>().map_err(|_| invalid())?;
        (
            host,
            if suffix.is_empty() {
                None
            } else {
                Some(suffix.strip_prefix(':').ok_or_else(invalid)?)
            },
        )
    } else {
        let (host, port) = authority
            .split_once(':')
            .map_or((authority, None), |(host, port)| (host, Some(port)));
        if host.is_empty()
            || host.len() > 253
            || !host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
        {
            return Err(invalid());
        }
        // 禁止整数、八进制、十六进制和缩写 IPv4 的不同解释。
        let last = host.rsplit_once('.').map_or(host, |(_, last)| last);
        if last.bytes().all(|b| b.is_ascii_digit())
            || last
                .strip_prefix("0x")
                .or_else(|| last.strip_prefix("0X"))
                .is_some_and(|digits| digits.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            let ip = host.parse::<Ipv4Addr>().map_err(|_| invalid())?;
            if ip.to_string() != host {
                return Err(invalid());
            }
        }
        (host, port)
    };
    if let Some(port) = port
        && (port.is_empty()
            || !port.bytes().all(|b| b.is_ascii_digit())
            || port.parse::<u16>().ok().is_none_or(|p| p == 0))
    {
        return Err(invalid());
    }
    if scheme == "http" && !matches!(host, "localhost" | "127.0.0.1" | "::1") {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secret::MemoryCredentials;

    #[test]
    fn proxy_precedence_and_loopback_bypass() {
        let root = tempfile::tempdir().unwrap();
        let secrets = SecretStore::with_backend(root.path(), MemoryCredentials::default()).unwrap();
        for endpoint in [
            "http://localhost:3128",
            "http://127.0.0.1:80",
            "http://[::1]:3128",
            "https://proxy.example:443",
            "https://proxy.example",
            "https://0xproxy.example:443",
        ] {
            validate_endpoint(endpoint).unwrap();
        }
        for endpoint in [
            "",
            "http://proxy.example:80",
            "socks5://127.0.0.1:80",
            "http://127.1:80",
            "http://2130706433:80",
            "http://0x7f000001:80",
            "http://localhost.evil:80",
            "http://user:password@localhost:80",
            "https://@proxy.example",
            "https://proxy.example/",
            "https://proxy.example?x",
            "https://proxy.example#x",
            "https://proxy.example:0",
            "https://proxy.example:65536",
            "https://proxy.example:\n80",
            "https://proxy.example\\x",
            "https://%70roxy.example",
            "https://[::1]suffix",
            "https://127.01.0.1:443",
            "https://0X7F000001:443",
        ] {
            assert_eq!(
                validate_endpoint(endpoint).unwrap_err().code(),
                INVALID_PROXY
            );
        }
        let config =
            ProxyConfig::new(ProxyMode::Manual, "http://localhost:3128".into(), true).unwrap();
        assert_eq!(
            ProxySnapshot::read(&config, &secrets, false)
                .err()
                .unwrap()
                .code(),
            CREDENTIALS_MISSING
        );
        for target in [
            "http://localhost/v1",
            "https://127.0.0.1:443/v1",
            "https://[::1]/v1",
        ] {
            assert!(is_exact_loopback(target));
            assert!(matches!(
                ProxySnapshot::read(&config, &secrets, is_exact_loopback(target)).unwrap(),
                ProxySnapshot::Direct
            ));
        }
        for target in [
            "https://localhost.evil/v1",
            "https://127.1/v1",
            "https://2130706433/v1",
            "https://[0:0:0:0:0:0:0:1]/v1",
        ] {
            assert!(!is_exact_loopback(target));
        }
        secrets
            .set(
                CREDENTIALS_KEY,
                &SecretString::from(
                    r#"{"username":"synthetic-user","password":"synthetic-password"}"#,
                ),
            )
            .unwrap();
        assert!(matches!(
            ProxySnapshot::read(&config, &secrets, false).unwrap(),
            ProxySnapshot::Manual {
                credentials: Some(_),
                ..
            }
        ));
        for invalid in [
            "",
            "null",
            r#"{"username":"x","password":"y","extra":true}"#,
            r#"{"username":"x:y","password":"z"}"#,
            r#"{"username":"x","password":""}"#,
        ] {
            secrets
                .set(CREDENTIALS_KEY, &SecretString::from(invalid))
                .unwrap();
            assert_eq!(
                ProxySnapshot::read(&config, &secrets, false)
                    .err()
                    .unwrap()
                    .code(),
                INVALID_PROXY
            );
        }
        assert!(matches!(
            ProxySnapshot::read(
                &ProxyConfig::new(ProxyMode::Direct, String::new(), false).unwrap(),
                &secrets,
                false
            )
            .unwrap(),
            ProxySnapshot::Direct
        ));
    }
    #[test]
    fn proxy_config_accessors_preserve_configured_values_in_both_modes() {
        for mode in [ProxyMode::Direct, ProxyMode::Manual] {
            for auth in [false, true] {
                let config =
                    ProxyConfig::new(mode, "https://proxy.example:443".into(), auth).unwrap();
                assert_eq!(config.mode(), mode);
                assert_eq!(config.endpoint(), "https://proxy.example:443");
                assert_eq!(config.auth(), auth);
            }
        }
        let direct = ProxyConfig::new(ProxyMode::Direct, String::new(), false).unwrap();
        assert_eq!(direct.endpoint(), "");
        assert!(!direct.auth());
    }

    #[test]
    fn proxy_config_validates_even_in_direct_mode() {
        assert!(ProxyConfig::new(ProxyMode::Direct, String::new(), false).is_ok());
        for mode in [ProxyMode::Direct, ProxyMode::Manual] {
            assert_eq!(
                ProxyConfig::new(mode, "http://proxy.example:80".into(), false)
                    .unwrap_err()
                    .code(),
                INVALID_PROXY
            );
        }
        assert!(ProxyConfig::new(ProxyMode::Manual, String::new(), false).is_err());
    }

    #[test]
    fn credential_encoding_round_trips_without_exposing_plaintext() {
        let original = ProxyCredentials {
            username: "user\"\\name".into(),
            password: "password\"\\value".into(),
        };
        let encoded = original.encode().unwrap();
        let decoded = ProxyCredentials::parse(&encoded).unwrap();
        assert_eq!(
            decoded.username.expose_secret(),
            original.username.expose_secret()
        );
        assert_eq!(
            decoded.password.expose_secret(),
            original.password.expose_secret()
        );
        assert!(!format!("{encoded:?}").contains("password"));
    }
}
