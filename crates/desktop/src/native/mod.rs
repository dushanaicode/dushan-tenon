//! 原生策略、补偿与状态机；宿主注入系统效果并在设置入口持有活动 owner/main 授权。

use std::sync::{Mutex, MutexGuard};

use tenon_framework::error::{AppError, ErrorCode, INTERNAL_UNEXPECTED, IpcError};

use crate::config::{ConfigSource, SETTINGS_OVERRIDDEN};

pub mod autostart;
pub mod chrome;
pub mod exit;
pub mod instance;
pub mod opener;
pub mod shortcuts;
pub mod tray;
pub mod updater;
pub mod window_controls;

pub const COMPENSATION_FAILED: ErrorCode = ErrorCode::new("app.native.compensation_failed");
pub const UNAVAILABLE: ErrorCode = ErrorCode::new("app.native.unavailable");

#[derive(Clone, Copy, Debug)]
struct NativeFailure {
    operation: ErrorCode,
    compensation: Option<ErrorCode>,
}

impl NativeFailure {
    fn new(operation: ErrorCode) -> Self {
        Self {
            operation,
            compensation: None,
        }
    }

    fn error(self) -> AppError {
        match self.compensation {
            Some(compensation) => AppError::new(COMPENSATION_FAILED)
                .with_param("operation", self.operation.as_str())
                .with_param("compensation", compensation.as_str()),
            None => AppError::new(self.operation),
        }
    }

    fn ipc(self, trace_id: &str) -> IpcError {
        let error = self.error();
        IpcError {
            code: error.code().as_str().into(),
            params: match self.compensation {
                Some(compensation) => [
                    ("operation".into(), self.operation.as_str().into()),
                    ("compensation".into(), compensation.as_str().into()),
                ]
                .into(),
                None => Default::default(),
            },
            trace_id: trace_id.into(),
        }
    }
}

fn check_source(source: ConfigSource, key: &'static str) -> Result<(), AppError> {
    if matches!(
        source,
        ConfigSource::Environment | ConfigSource::CommandLine
    ) {
        Err(AppError::new(SETTINGS_OVERRIDDEN).with_param("key", key))
    } else {
        Ok(())
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, AppError> {
    mutex.lock().map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
}

#[cfg(test)]
fn test_config() -> crate::config::LoadedConfig {
    let root = tempfile::tempdir().unwrap();
    crate::config::load(root.path(), [], &[]).unwrap()
}

#[cfg(test)]
mod tests;
