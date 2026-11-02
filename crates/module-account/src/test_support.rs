//! 供模块测试复用的内存认证设置；不加载配置文件、不依赖 desktop。

use std::sync::Mutex;

use tenon_framework::error::{AppError, INTERNAL_UNEXPECTED};

use crate::{AuthMode, AuthPolicy, AuthSettings};

pub struct MemoryAuthSettings {
    policy: Mutex<AuthPolicy>,
}

impl MemoryAuthSettings {
    pub fn new(policy: AuthPolicy) -> Self {
        Self {
            policy: Mutex::new(policy),
        }
    }

    /// 替换完整策略，用于测试下一次读取时的实时生效行为。
    pub fn set_policy(&self, policy: AuthPolicy) -> Result<(), AppError> {
        *self
            .policy
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))? = policy;
        Ok(())
    }
}

impl AuthSettings for MemoryAuthSettings {
    fn read(&self) -> Result<AuthPolicy, AppError> {
        Ok(*self
            .policy
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?)
    }

    fn set_mode(&self, mode: AuthMode) -> Result<(), AppError> {
        self.policy
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .mode = mode;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poisoned_settings_return_internal_error_for_reads_and_writes() {
        let policy = crate::db::policy(AuthMode::None);
        let settings = MemoryAuthSettings::new(policy);
        let _ = std::panic::catch_unwind(|| {
            let _guard = settings.policy.lock().unwrap();
            panic!("poison auth settings");
        });
        assert_eq!(settings.read().unwrap_err().code(), INTERNAL_UNEXPECTED);
        assert_eq!(
            settings.set_mode(AuthMode::Login).unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            settings.set_policy(policy).unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
    }
}
