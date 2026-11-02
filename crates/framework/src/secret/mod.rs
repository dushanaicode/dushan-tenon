//! 环境变量与凭据后端；规范化状态目录隔离命名空间，环境读取失败不回退，仅依赖 error。

use std::{fmt, path::Path};

use secrecy::SecretString;
use sha2::{Digest, Sha256};

use crate::error::{AppError, ErrorCode};

pub const SECRET_NOT_FOUND: ErrorCode = ErrorCode::new("app.secret.not_found");
pub const SECRET_INVALID_KEY: ErrorCode = ErrorCode::new("app.secret.invalid_key");
pub const SECRET_UNAVAILABLE: ErrorCode = ErrorCode::new("app.secret.unavailable");

/// 将合法秘密键映射到唯一的环境变量名；非法键在访问来源前拒绝。
pub fn environment_variable(key: &str) -> Result<String, AppError> {
    validate_key(key)?;
    Ok(format!(
        "TENON_SECRET__{}",
        key.to_ascii_uppercase().replace('.', "__")
    ))
}

fn is_valid_key(key: &str) -> bool {
    key.contains('.')
        && key.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        })
}

pub fn validate_key(key: &str) -> Result<(), AppError> {
    if is_valid_key(key) {
        Ok(())
    } else {
        Err(AppError::new(SECRET_INVALID_KEY))
    }
}

/// 后端错误不携带平台错误文本或原始凭据字节。
#[derive(Debug)]
pub enum CredentialError {
    NotFound,
    Unavailable,
}

/// 注入内存替身时仍经过同一读取顺序、键名校验和状态目录命名空间。
pub trait CredentialBackend {
    fn get(&self, account: &str) -> Result<SecretString, CredentialError>;
    fn set(&self, account: &str, value: &SecretString) -> Result<(), CredentialError>;
    fn delete(&self, account: &str) -> Result<(), CredentialError>;
}

pub struct SystemCredentials {
    service: String,
}

impl SystemCredentials {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }
}

impl<B: CredentialBackend + ?Sized> CredentialBackend for Box<B> {
    fn get(&self, account: &str) -> Result<SecretString, CredentialError> {
        (**self).get(account)
    }
    fn set(&self, account: &str, value: &SecretString) -> Result<(), CredentialError> {
        (**self).set(account, value)
    }
    fn delete(&self, account: &str) -> Result<(), CredentialError> {
        (**self).delete(account)
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
impl CredentialBackend for SystemCredentials {
    fn get(&self, account: &str) -> Result<SecretString, CredentialError> {
        keyring::Entry::new(&self.service, account)
            .and_then(|entry| entry.get_password())
            .map(SecretString::from)
            .map_err(credential_error)
    }

    fn set(&self, account: &str, value: &SecretString) -> Result<(), CredentialError> {
        use secrecy::ExposeSecret;
        keyring::Entry::new(&self.service, account)
            .and_then(|entry| entry.set_password(value.expose_secret()))
            .map_err(credential_error)
    }

    fn delete(&self, account: &str) -> Result<(), CredentialError> {
        keyring::Entry::new(&self.service, account)
            .and_then(|entry| entry.delete_credential())
            .map_err(credential_error)
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn credential_error(error: keyring::Error) -> CredentialError {
    match error {
        keyring::Error::NoEntry => CredentialError::NotFound,
        // BadEncoding 等错误可能带原始秘密，不能作为 AppError.source 留存。
        _ => CredentialError::Unavailable,
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
impl CredentialBackend for SystemCredentials {
    fn get(&self, _: &str) -> Result<SecretString, CredentialError> {
        Err(CredentialError::Unavailable)
    }
    fn set(&self, _: &str, _: &SecretString) -> Result<(), CredentialError> {
        Err(CredentialError::Unavailable)
    }
    fn delete(&self, _: &str) -> Result<(), CredentialError> {
        Err(CredentialError::Unavailable)
    }
}

pub struct SecretStore<B = SystemCredentials> {
    namespace: String,
    backend: B,
}

impl<B> fmt::Debug for SecretStore<B> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SecretStore")
            .field("namespace", &self.namespace)
            .finish_non_exhaustive()
    }
}

impl SecretStore {
    pub fn new(state_root: &Path, service: impl Into<String>) -> Result<Self, AppError> {
        Self::with_backend(state_root, SystemCredentials::new(service))
    }
}

impl<B: CredentialBackend> SecretStore<B> {
    pub fn boxed(self) -> SecretStore<Box<dyn CredentialBackend + Send + Sync>>
    where
        B: Send + Sync + 'static,
    {
        SecretStore {
            namespace: self.namespace,
            backend: Box::new(self.backend),
        }
    }

    /// 状态目录须已存在；canonicalize 合并相对路径、.. 与目录链接。
    pub fn with_backend(state_root: &Path, backend: B) -> Result<Self, AppError> {
        let invalid = || AppError::new(SECRET_UNAVAILABLE).with_param("operation", "namespace");
        let path = state_root.canonicalize().map_err(|_| invalid())?;
        if !path.is_dir() {
            return Err(invalid());
        }
        let normalized = path.to_str().ok_or_else(invalid)?;
        #[cfg(windows)]
        let normalized = normalized.to_lowercase();
        let digest = format!("{:x}", Sha256::digest(normalized.as_bytes()));
        Ok(Self {
            namespace: digest[..16].to_owned(),
            backend,
        })
    }

    pub fn get(&self, key: &str) -> Result<SecretString, AppError> {
        self.get_from(key, |name| match std::env::var(name) {
            Ok(value) => Ok(Some(SecretString::from(value))),
            Err(std::env::VarError::NotPresent) => Ok(None),
            Err(std::env::VarError::NotUnicode(_)) => Err(CredentialError::Unavailable),
        })
    }

    fn get_from(
        &self,
        key: &str,
        environment: impl FnOnce(&str) -> Result<Option<SecretString>, CredentialError>,
    ) -> Result<SecretString, AppError> {
        let variable = environment_variable(key)?;
        // 存在即使用，包括空字符串；读取失败也不转向另一来源。
        match environment(&variable).map_err(|error| secret_error(key, "environment", error))? {
            Some(value) => Ok(value),
            None => self
                .backend
                .get(&self.account(key))
                .map_err(|error| secret_error(key, "get", error)),
        }
    }

    pub fn set(&self, key: &str, value: &SecretString) -> Result<(), AppError> {
        validate_key(key)?;
        self.backend
            .set(&self.account(key), value)
            .map_err(|error| secret_error(key, "set", error))
    }

    /// 事务补偿只读取凭据库原值，不能把环境覆盖项写回凭据库。
    pub fn get_stored(&self, key: &str) -> Result<SecretString, AppError> {
        validate_key(key)?;
        self.backend
            .get(&self.account(key))
            .map_err(|error| secret_error(key, "get", error))
    }

    pub fn delete(&self, key: &str) -> Result<(), AppError> {
        validate_key(key)?;
        self.backend
            .delete(&self.account(key))
            .map_err(|error| secret_error(key, "delete", error))
    }

    fn account(&self, key: &str) -> String {
        format!("{}/{key}", self.namespace)
    }
}

fn secret_error(key: &str, operation: &'static str, error: CredentialError) -> AppError {
    let code = match error {
        CredentialError::NotFound => SECRET_NOT_FOUND,
        CredentialError::Unavailable => SECRET_UNAVAILABLE,
    };
    AppError::new(code)
        .with_param("key", key)
        .with_param("operation", operation)
}

#[cfg(test)]
mod tests;

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Default)]
pub struct MemoryCredentials(
    std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<String, SecretString>>>,
);

#[cfg(any(test, feature = "test-support"))]
impl CredentialBackend for MemoryCredentials {
    fn get(&self, account: &str) -> Result<SecretString, CredentialError> {
        self.0
            .lock()
            .map_err(|_| CredentialError::Unavailable)?
            .get(account)
            .cloned()
            .ok_or(CredentialError::NotFound)
    }
    fn set(&self, account: &str, value: &SecretString) -> Result<(), CredentialError> {
        self.0
            .lock()
            .map_err(|_| CredentialError::Unavailable)?
            .insert(account.into(), value.clone());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), CredentialError> {
        self.0
            .lock()
            .map_err(|_| CredentialError::Unavailable)?
            .remove(account)
            .map(|_| ())
            .ok_or(CredentialError::NotFound)
    }
}
