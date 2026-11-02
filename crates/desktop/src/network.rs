//! 代理设置与凭据补偿；宿主先授权并持共享配置的独占锁，直至秘密和配置完成提交或补偿。

use std::path::Path;

use serde::{Deserialize, Serialize};
use tenon_framework::{
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    network::{CREDENTIALS_KEY, CREDENTIALS_MISSING, INVALID_PROXY, ProxyCredentials, ProxyMode},
    secret::{CredentialBackend, SECRET_NOT_FOUND, SecretStore, environment_variable},
};
use ts_rs::TS;

use crate::config::{LoadedConfig, NetworkConfigSettings, SETTINGS_OVERRIDDEN};

pub const COMPENSATION_FAILED: ErrorCode = ErrorCode::new("app.network.compensation_failed");

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    #[serde(flatten)]
    pub config: NetworkConfigSettings,
    pub credentials_set: bool,
    pub credential_source: CredentialSource,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CredentialSource {
    None,
    Environment,
    CredentialStore,
}

// 秘密输入不实现 Debug/Serialize；校验时立即转入 framework 的 SecretString。
#[derive(Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProxyCredentialChange {
    Keep(#[ts(skip)] NoProxyCredentials),
    Clear(#[ts(skip)] NoProxyCredentials),
    Replace(ProxyCredentialReplacement),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoProxyCredentials {}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProxyCredentialReplacement {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkSettingsUpdate {
    pub mode: ProxyMode,
    pub endpoint: String,
    pub auth: bool,
    pub credentials: ProxyCredentialChange,
}

fn optional<T>(result: Result<T, AppError>) -> Result<Option<T>, AppError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == SECRET_NOT_FOUND => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn settings<B: CredentialBackend>(
    config: &LoadedConfig,
    secrets: &SecretStore<B>,
    authorize: impl FnOnce() -> Result<(), AppError>,
) -> Result<NetworkSettings, AppError> {
    authorize()?;
    let credentials_set = optional(secrets.get(CREDENTIALS_KEY))?.is_some();
    Ok(NetworkSettings {
        config: config.network_settings(),
        credentials_set,
        credential_source: if environment_credentials()? {
            CredentialSource::Environment
        } else if credentials_set {
            CredentialSource::CredentialStore
        } else {
            CredentialSource::None
        },
    })
}

fn environment_credentials() -> Result<bool, AppError> {
    Ok(std::env::var_os(environment_variable(CREDENTIALS_KEY)?).is_some())
}

pub fn update<B: CredentialBackend>(
    config: &mut LoadedConfig,
    root: &Path,
    secrets: &SecretStore<B>,
    input: NetworkSettingsUpdate,
    authorize: impl FnOnce() -> Result<(), AppError>,
) -> Result<NetworkSettings, AppError> {
    authorize()?;
    update_with_source(config, root, secrets, input, environment_credentials()?)
}

/// 关闭代理只切模式；保留端点、认证意图和秘密。显式 Clear 才删除凭据。
pub fn disable<B: CredentialBackend>(
    config: &mut LoadedConfig,
    root: &Path,
    secrets: &SecretStore<B>,
    authorize: impl FnOnce() -> Result<(), AppError>,
) -> Result<NetworkSettings, AppError> {
    let input = NetworkSettingsUpdate {
        mode: ProxyMode::Direct,
        endpoint: config.proxy().endpoint().into(),
        auth: config.proxy().auth(),
        credentials: ProxyCredentialChange::Keep(NoProxyCredentials {}),
    };
    update(config, root, secrets, input, authorize)
}

fn update_with_source<B: CredentialBackend>(
    config: &mut LoadedConfig,
    root: &Path,
    secrets: &SecretStore<B>,
    input: NetworkSettingsUpdate,
    environment: bool,
) -> Result<NetworkSettings, AppError> {
    if environment {
        return Err(AppError::new(SETTINGS_OVERRIDDEN).with_param("key", CREDENTIALS_KEY));
    }
    config.validate_network_settings(input.mode, &input.endpoint, input.auth)?;
    let changed = !matches!(input.credentials, ProxyCredentialChange::Keep(_));
    // 在任何秘密写入前校验整组输入，包括认证开关和替换内容。
    let replacement = match input.credentials {
        ProxyCredentialChange::Replace(ProxyCredentialReplacement { username, password }) => {
            let credentials = ProxyCredentials {
                username: username.into(),
                password: password.into(),
            };
            credentials.validate()?;
            Some(credentials.encode()?)
        }
        ProxyCredentialChange::Clear(_) if input.auth => return Err(AppError::new(INVALID_PROXY)),
        _ => None,
    };
    let original = optional(secrets.get_stored(CREDENTIALS_KEY))?;
    let next = if changed {
        replacement
    } else {
        original.clone()
    };
    if input.mode == ProxyMode::Manual && input.auth {
        ProxyCredentials::parse(
            next.as_ref()
                .ok_or_else(|| AppError::new(CREDENTIALS_MISSING))?,
        )?;
    }
    commit_secrets(
        changed,
        original.as_ref(),
        next.as_ref(),
        |value| match value {
            Some(value) => secrets.set(CREDENTIALS_KEY, value),
            None => optional(secrets.delete(CREDENTIALS_KEY)).map(|_| ()),
        },
        || {
            config
                .update_network_settings(root, input.mode, &input.endpoint, input.auth)
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
        },
    )?;
    Ok(NetworkSettings {
        config: config.network_settings(),
        credentials_set: next.is_some(),
        credential_source: if next.is_some() {
            CredentialSource::CredentialStore
        } else {
            CredentialSource::None
        },
    })
}

fn commit_secrets<T>(
    changed: bool,
    original: Option<&T>,
    next: Option<&T>,
    mut write: impl FnMut(Option<&T>) -> Result<(), AppError>,
    persist: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let applied = if changed { write(next) } else { Ok(()) }.and_then(|()| persist());
    if let Err(error) = applied {
        if changed && let Err(compensation) = write(original) {
            return Err(AppError::new(COMPENSATION_FAILED)
                .with_param("operation", error.code().as_str())
                .with_param("compensation", compensation.code().as_str()));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
