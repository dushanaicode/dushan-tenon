//! 手动 SQLite 归档。调用方必须持有 OperationGate 独占，并完成模块自检。
mod archive;
mod diagnostics;
mod manifest;
pub mod restore;
mod sqlite;
mod storage;

pub use archive::{BackupInput, Phase, Progress, check_quiescent, export, validate_archive};
pub use diagnostics::export_diagnostics;
pub use manifest::{BackupManifest, ManifestEntry, MigrationEntry};
use storage::{Target, same_volume};
pub use storage::{check_layout, regular_path};

use std::sync::atomic::{AtomicU8, Ordering};

use crate::error::{AppError, ErrorCode};

pub const UNSUPPORTED_DATABASE: ErrorCode = ErrorCode::new("app.backup.unsupported_database");
pub const STORAGE_UNSUPPORTED: ErrorCode = ErrorCode::new("app.backup.storage_layout_unsupported");
pub const NOT_QUIESCENT: ErrorCode = ErrorCode::new("app.backup.not_quiescent");
pub const FILE_MISSING: ErrorCode = ErrorCode::new("app.backup.file_missing");
pub const INVALID_ARCHIVE: ErrorCode = ErrorCode::new("app.backup.invalid_archive");
pub const TOO_LARGE: ErrorCode = ErrorCode::new("app.backup.too_large");
pub const HASH_MISMATCH: ErrorCode = ErrorCode::new("app.backup.hash_mismatch");
pub const EXPORT_FAILED: ErrorCode = ErrorCode::new("app.backup.export_failed");
pub const CANCELLED: ErrorCode = ErrorCode::new("app.backup.cancelled");
pub const UNSUPPORTED_CACHE: ErrorCode = ErrorCode::new("app.backup.unsupported_cache");
pub const RESTORE_EXPIRED: ErrorCode = ErrorCode::new("app.backup.restore_expired");
pub const RESTORE_FAILED: ErrorCode = ErrorCode::new("app.backup.restore_failed");
pub const ROLLBACK_FAILED: ErrorCode = ErrorCode::new("app.backup.rollback_failed");
pub const MAX_ENTRIES: usize = 10_000;
pub const MAX_MANIFEST: u64 = 1024 * 1024;
pub const MAX_DATABASE: u64 = 512 * 1024 * 1024;
pub const MAX_FILE: u64 = 20 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;

/// 0=可取消，1=已取消，2=进入原子提交。取消与提交只有一个能赢。
#[derive(Default)]
pub struct Cancellation(AtomicU8);

impl Cancellation {
    pub fn cancel(&self) {
        let _ = self
            .0
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire);
    }

    pub fn check(&self) -> Result<(), AppError> {
        if self.0.load(Ordering::Acquire) == 1 {
            Err(AppError::new(CANCELLED))
        } else {
            Ok(())
        }
    }

    pub fn can_cancel(&self) -> bool {
        self.0.load(Ordering::Acquire) == 0
    }

    fn commit(&self) -> Result<(), AppError> {
        self.0
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| AppError::new(CANCELLED))
    }
}

#[cfg(test)]
mod tests;
