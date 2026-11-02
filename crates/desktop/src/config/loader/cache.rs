//! 缓存原始字段只用于加载；本机模式拒绝全部 Redis 字段，即使显式填了默认值。

use std::{
    num::{NonZeroU16, NonZeroU64},
    path::{Path, PathBuf},
};

use serde::Deserialize;
use tenon_framework::{
    cache::{
        CacheConfig, CacheConnection, CacheProvider, DEFAULT_LOCAL_CAPACITY, RedisConfig,
        valid_name,
    },
    network::TlsMode,
};

use super::{ConfigError, remote::secret_and_ca};
use crate::identity::DEFAULT_CACHE_KEY_PREFIX;

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct RawCache {
    provider: CacheProvider,
    key_prefix: String,
    local_capacity: NonZeroU64,
    host: Option<String>,
    port: Option<NonZeroU16>,
    db: Option<u32>,
    username: Option<String>,
    password_secret: Option<String>,
    tls: Option<TlsMode>,
    tls_ca_file: Option<PathBuf>,
}

impl Default for RawCache {
    fn default() -> Self {
        Self {
            provider: CacheProvider::Local,
            key_prefix: DEFAULT_CACHE_KEY_PREFIX.into(),
            local_capacity: const { NonZeroU64::new(DEFAULT_LOCAL_CAPACITY).unwrap() },
            host: None,
            port: None,
            db: None,
            username: None,
            password_secret: None,
            tls: None,
            tls_ca_file: None,
        }
    }
}

impl RawCache {
    pub(super) fn into_config(self, root: &Path) -> Result<CacheConfig, ConfigError> {
        let field = |key: &str, reason: &str| ConfigError::field(format!("cache.{key}"), reason);
        if !valid_name(&self.key_prefix) {
            return Err(field("key_prefix", "必须为非空的 [a-z0-9_.-] 字符串"));
        }
        let connection = match self.provider {
            CacheProvider::Local => {
                for (key, present) in [
                    ("host", self.host.is_some()),
                    ("port", self.port.is_some()),
                    ("db", self.db.is_some()),
                    ("username", self.username.is_some()),
                    ("password_secret", self.password_secret.is_some()),
                    ("tls", self.tls.is_some()),
                    ("tls_ca_file", self.tls_ca_file.is_some()),
                ] {
                    if present {
                        return Err(field(key, "本机缓存不接受 Redis 字段"));
                    }
                }
                CacheConnection::Local
            }
            CacheProvider::Redis => {
                let host = self.host.ok_or_else(|| field("host", "Redis 必填字段"))?;
                if host.is_empty()
                    || host.chars().any(|c| {
                        c.is_whitespace() || matches!(c, '\0' | '/' | '\\' | '@' | '?' | '#')
                    })
                {
                    return Err(field(
                        "host",
                        "必须为主机名或 IP，不接受 URL 或 socket 路径",
                    ));
                }
                let port = self.port.ok_or_else(|| field("port", "Redis 必填字段"))?;
                if let Some(username) = &self.username
                    && (username.trim().is_empty() || username.contains('\0'))
                {
                    return Err(field("username", "必须为非空且不含 NUL 的字符串"));
                }
                let password_secret = self
                    .password_secret
                    .unwrap_or_else(|| "cache.redis_password".into());
                let tls_ca_file = secret_and_ca("cache", &password_secret, self.tls_ca_file, root)?;
                CacheConnection::Redis(RedisConfig {
                    host,
                    port,
                    db: self.db.unwrap_or(0),
                    username: self.username,
                    password_secret,
                    tls: self.tls.unwrap_or_default(),
                    tls_ca_file,
                })
            }
        };
        Ok(CacheConfig {
            connection,
            key_prefix: self.key_prefix,
            local_capacity: self.local_capacity,
        })
    }
}
