//! 字节缓存与租期锁；键前缀必填，锁显式释放，Drop 不执行 I/O。
//! 依赖 error、dict、secret、network；连接失败不回退本机后端。

use std::{
    collections::HashMap,
    fmt,
    num::{NonZeroU16, NonZeroU64},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use ts_rs::TS;
use uuid::Uuid;

use crate::{
    dict::DictDeclaration,
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    network::TlsMode,
    secret::{CredentialBackend, SecretStore},
};

pub const DEFAULT_LOCAL_CAPACITY: u64 = 10_000;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum CacheProvider {
    #[default]
    Local,
    Redis,
}

#[derive(Clone, Debug)]
pub struct RedisConfig {
    pub host: String,
    pub port: NonZeroU16,
    pub db: u32,
    pub username: Option<String>,
    pub password_secret: String,
    pub tls: TlsMode,
    pub tls_ca_file: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub enum CacheConnection {
    Local,
    Redis(RedisConfig),
}

#[derive(Clone, Debug)]
pub struct CacheConfig {
    pub connection: CacheConnection,
    pub key_prefix: String,
    pub local_capacity: NonZeroU64,
}

impl CacheConfig {
    pub fn provider(&self) -> CacheProvider {
        match self.connection {
            CacheConnection::Local => CacheProvider::Local,
            CacheConnection::Redis(_) => CacheProvider::Redis,
        }
    }

    /// 本机位置由界面翻译；Redis 只包含非秘密地址。
    pub fn location(&self) -> Option<String> {
        match &self.connection {
            CacheConnection::Local => None,
            CacheConnection::Redis(remote) => {
                Some(format!("{}:{}/{}", remote.host, remote.port, remote.db))
            }
        }
    }
}

pub const CACHE_UNAVAILABLE: ErrorCode = ErrorCode::new("app.cache.unavailable");

crate::dict_enum! {
    pub enum CacheConnectionStatus {
        Connected => "connected" (Success),
        Error => "error" (Danger),
    }
}

/// 本服务的连接状态字典，由上层汇总。
pub const DICTIONARIES: &[DictDeclaration] = &[DictDeclaration {
    code: "framework.cache_status",
    items: CacheConnectionStatus::ITEMS,
}];

mod connect;
use connect::unavailable;

#[derive(Clone)]
pub struct Cache {
    prefix: String,
    backend: Backend,
}

#[derive(Clone)]
enum Backend {
    Local(Arc<Local>),
    Redis(redis::aio::ConnectionManager),
}

struct Local {
    values: moka::future::Cache<String, Value>,
    // 锁不参与缓存容量淘汰，否则尚未到期的锁会提前失效。
    locks: Mutex<HashMap<String, (Uuid, Instant)>>,
}

#[derive(Clone)]
struct Value {
    bytes: Vec<u8>,
    expires: Instant,
}

struct Expiry;
impl moka::Expiry<String, Value> for Expiry {
    fn expire_after_create(&self, _: &String, value: &Value, now: Instant) -> Option<Duration> {
        Some(value.expires.saturating_duration_since(now))
    }

    fn expire_after_update(
        &self,
        _: &String,
        value: &Value,
        now: Instant,
        _: Option<Duration>,
    ) -> Option<Duration> {
        Some(value.expires.saturating_duration_since(now))
    }
}

impl fmt::Debug for Cache {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Cache")
            .field("provider", &self.provider())
            .field("prefix", &self.prefix)
            .finish_non_exhaustive()
    }
}

impl Cache {
    pub async fn connect(
        config: &CacheConfig,
        secrets: &SecretStore<impl CredentialBackend>,
    ) -> Result<Self, AppError> {
        validate_name(&config.key_prefix)?;
        let backend = match &config.connection {
            CacheConnection::Local => Backend::Local(Arc::new(Local {
                values: moka::future::Cache::builder()
                    .max_capacity(config.local_capacity.get())
                    .expire_after(Expiry)
                    .build(),
                locks: Mutex::new(HashMap::new()),
            })),
            CacheConnection::Redis(remote) => {
                Backend::Redis(connect::connect(remote, secrets).await?)
            }
        };
        let cache = Self {
            prefix: config.key_prefix.clone(),
            backend,
        };
        cache.ping().await?;
        Ok(cache)
    }

    pub fn provider(&self) -> CacheProvider {
        match self.backend {
            Backend::Local(_) => CacheProvider::Local,
            Backend::Redis(_) => CacheProvider::Redis,
        }
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        if let Backend::Redis(connection) = &self.backend {
            let pong: String = redis::cmd("PING")
                .query_async(&mut connection.clone())
                .await
                .map_err(|_| unavailable())?;
            if pong != "PONG" {
                return Err(unavailable());
            }
        }
        Ok(())
    }

    fn data_key(&self, ns: &str, key: &str) -> Result<String, AppError> {
        validate_name(ns)?;
        validate_name(key)?;
        Ok(format!("{}:{ns}:{key}", self.prefix))
    }

    pub async fn get(&self, ns: &str, key: &str) -> Result<Option<Vec<u8>>, AppError> {
        let key = self.data_key(ns, key)?;
        match &self.backend {
            Backend::Local(local) => Ok(local.values.get(&key).await.map(|value| value.bytes)),
            Backend::Redis(connection) => redis::cmd("GET")
                .arg(key)
                .query_async(&mut connection.clone())
                .await
                .map_err(|_| unavailable()),
        }
    }

    /// TTL 必须为正整数毫秒；所有用户数据均到期，不提供永久写入入口。
    pub async fn set(
        &self,
        ns: &str,
        key: &str,
        value: &[u8],
        ttl: Duration,
    ) -> Result<(), AppError> {
        let millis = ttl_millis(ttl)?;
        let key = self.data_key(ns, key)?;
        match &self.backend {
            Backend::Local(local) => {
                let expires = Instant::now()
                    .checked_add(ttl)
                    .ok_or_else(|| internal("缓存 TTL 超出时钟范围"))?;
                local
                    .values
                    .insert(
                        key,
                        Value {
                            bytes: value.to_vec(),
                            expires,
                        },
                    )
                    .await;
                Ok(())
            }
            Backend::Redis(connection) => redis::cmd("SET")
                .arg(key)
                .arg(value)
                .arg("PX")
                .arg(millis)
                .query_async(&mut connection.clone())
                .await
                .map_err(|_| unavailable()),
        }
    }

    pub async fn delete(&self, ns: &str, key: &str) -> Result<(), AppError> {
        let key = self.data_key(ns, key)?;
        match &self.backend {
            Backend::Local(local) => {
                local.values.invalidate(&key).await;
                Ok(())
            }
            Backend::Redis(connection) => redis::cmd("DEL")
                .arg(key)
                .query_async(&mut connection.clone())
                .await
                .map_err(|_| unavailable()),
        }
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        ns: &str,
        key: &str,
    ) -> Result<Option<T>, AppError> {
        self.get(ns, key)
            .await?
            .map(|value| serde_json::from_slice(&value).map_err(|_| internal("缓存 JSON 解码失败")))
            .transpose()
    }

    pub async fn set_json<T: Serialize + ?Sized>(
        &self,
        ns: &str,
        key: &str,
        value: &T,
        ttl: Duration,
    ) -> Result<(), AppError> {
        let bytes = serde_json::to_vec(value).map_err(|_| internal("缓存 JSON 编码失败"))?;
        self.set(ns, key, &bytes, ttl).await
    }

    /// 争用返回 None；通信错误仍显式返回 AppError，不能伪装为争用。
    pub async fn try_lock(&self, name: &str, ttl: Duration) -> Result<Option<LockGuard>, AppError> {
        validate_name(name)?;
        let millis = ttl_millis(ttl)?;
        // @ 不在合法命名空间字符集中，锁不会与数据碰撞。
        let key = format!("{}:@lock:{name}", self.prefix);
        let token = Uuid::new_v4();
        let acquired = match &self.backend {
            Backend::Local(local) => {
                let now = Instant::now();
                let expires = now
                    .checked_add(ttl)
                    .ok_or_else(|| internal("锁 TTL 超出时钟范围"))?;
                let mut locks = local.locks.lock().map_err(|_| internal("缓存内部锁中毒"))?;
                // 按活跃锁数量 O(n) 清理；锁规模增大时改为到期队列。
                locks.retain(|_, (_, expires)| *expires > now);
                match locks.entry(key.clone()) {
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        entry.insert((token, expires));
                        true
                    }
                    std::collections::hash_map::Entry::Occupied(_) => false,
                }
            }
            Backend::Redis(connection) => redis::cmd("SET")
                .arg(&key)
                .arg(token.to_string())
                .arg("NX")
                .arg("PX")
                .arg(millis)
                .query_async::<Option<String>>(&mut connection.clone())
                .await
                .map_err(|_| unavailable())?
                .is_some(),
        };
        Ok(acquired.then(|| LockGuard {
            backend: self.backend.clone(),
            key,
            token,
        }))
    }
}

/// Drop 不释放锁且不执行异步 I/O；未显式 release 的锁等待 TTL 到期。
pub struct LockGuard {
    backend: Backend,
    key: String,
    token: Uuid,
}

impl fmt::Debug for LockGuard {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LockGuard")
            .field("key", &self.key)
            .finish_non_exhaustive()
    }
}

impl LockGuard {
    /// 可重试且幂等；过期令牌无法删除后来持有者的锁。
    pub async fn release(&self) -> Result<(), AppError> {
        match &self.backend {
            Backend::Local(local) => {
                let mut locks = local.locks.lock().map_err(|_| internal("缓存内部锁中毒"))?;
                if locks.get(&self.key).is_some_and(|(token, _)| *token == self.token) {
                    locks.remove(&self.key);
                }
                Ok(())
            }
            Backend::Redis(connection) => redis::Script::new("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end")
                .key(&self.key).arg(self.token.to_string()).invoke_async::<()>(&mut connection.clone()).await.map_err(|_| unavailable()),
        }
    }
}

pub(crate) fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'.' | b'-')
        })
}

fn validate_name(value: &str) -> Result<(), AppError> {
    if valid_name(value) {
        Ok(())
    } else {
        Err(internal("缓存名称必须为非空的 [a-z0-9_.-] 字符串"))
    }
}

fn ttl_millis(ttl: Duration) -> Result<i64, AppError> {
    let millis = i64::try_from(ttl.as_millis()).map_err(|_| internal("缓存 TTL 超出范围"))?;
    if millis == 0 || !ttl.subsec_nanos().is_multiple_of(1_000_000) {
        return Err(internal("缓存 TTL 必须为正整数毫秒"));
    }
    Ok(millis)
}

fn internal(message: &'static str) -> AppError {
    AppError::new(INTERNAL_UNEXPECTED).with_source(std::io::Error::other(message))
}

#[cfg(test)]
mod tests;
