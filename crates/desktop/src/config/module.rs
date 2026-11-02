//! 模块专属认证与通知配置；值的注入由宿主和模块端口决定。

use super::ConfigError;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct NotifyConfig {
    pub desktop: bool,
}

impl Default for NotifyConfig {
    fn default() -> Self {
        Self { desktop: true }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct AuthConfig {
    pub mode: AuthMode,
    pub session_max_hours: i64,
    pub captcha_after_failures: i64,
    pub lock_after_failures: i64,
    pub lock_minutes: i64,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            mode: AuthMode::None,
            session_max_hours: 24,
            captcha_after_failures: 3,
            lock_after_failures: 10,
            lock_minutes: 15,
        }
    }
}

impl AuthConfig {
    pub(super) fn validate(&self) -> Result<(), ConfigError> {
        for (path, value, max) in [
            (
                "auth.captcha_after_failures",
                self.captcha_after_failures,
                100,
            ),
            ("auth.lock_minutes", self.lock_minutes, 1440),
        ] {
            if !(1..=max).contains(&value) {
                return Err(ConfigError::Field {
                    path: path.into(),
                    reason: format!("必须在 1–{max} 之间"),
                });
            }
        }
        if self.lock_after_failures <= self.captcha_after_failures
            || self.lock_after_failures > 1000
        {
            return Err(ConfigError::Field {
                path: "auth.lock_after_failures".into(),
                reason: "必须大于 auth.captcha_after_failures 且不超过 1000".into(),
            });
        }
        if self.mode == AuthMode::Login && !(1..=720).contains(&self.session_max_hours) {
            return Err(ConfigError::Field {
                path: "auth.session_max_hours".into(),
                reason: "必须在 1–720 之间".into(),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    #[default]
    None,
    Login,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct ModuleConfig {
    pub enabled: bool,
}

impl Default for ModuleConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}
