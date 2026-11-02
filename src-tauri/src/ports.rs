//! 消费方端口的 desktop 配置适配；读写共享同一把锁。

use std::{path::PathBuf, sync::RwLockReadGuard};

use tenon_desktop::config::{self, LoadedConfig};
use tenon_framework::error::{AppError, INTERNAL_UNEXPECTED};
use tenon_module_account::{AuthMode, AuthPolicy, AuthSettings};
use tenon_module_notify::{DesktopDelivery, DesktopGate};

use crate::state::SharedConfig;

pub(crate) fn read(config: &SharedConfig) -> Result<RwLockReadGuard<'_, LoadedConfig>, AppError> {
    config
        .read()
        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
}

pub(crate) struct SettingsPorts {
    pub config: SharedConfig,
    pub root: PathBuf,
}

impl AuthSettings for SettingsPorts {
    fn read(&self) -> Result<AuthPolicy, AppError> {
        let auth = read(&self.config)?.auth();
        Ok(AuthPolicy {
            mode: match auth.mode {
                config::AuthMode::None => AuthMode::None,
                config::AuthMode::Login => AuthMode::Login,
            },
            session_max_hours: auth.session_max_hours,
            captcha_after_failures: auth.captcha_after_failures,
            lock_after_failures: auth.lock_after_failures,
            lock_minutes: auth.lock_minutes,
        })
    }

    fn set_mode(&self, mode: AuthMode) -> Result<(), AppError> {
        self.config
            .write()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .update_auth_mode(
                &self.root,
                match mode {
                    AuthMode::None => config::AuthMode::None,
                    AuthMode::Login => config::AuthMode::Login,
                },
            )
    }
}

impl DesktopGate for SettingsPorts {
    fn with_enabled(
        &self,
        send: &mut dyn FnMut() -> Result<DesktopDelivery, AppError>,
    ) -> Result<DesktopDelivery, AppError> {
        let config = read(&self.config)?;
        if config.notify().desktop {
            send()
        } else {
            Ok(DesktopDelivery::Skipped)
        }
    }
}

#[cfg(test)]
mod tests;
