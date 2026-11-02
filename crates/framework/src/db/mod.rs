//! 数据访问核心。业务值经 sea-query 参数绑定；写入审计字段使用执行上下文。

mod bind;
mod codec;
mod config;
mod connect;
pub mod migrate;
mod page;
mod pool;
mod query;
mod table;

pub use config::{DatabaseConfig, DatabaseConnection, DatabaseKind, RemoteDatabaseConfig};
pub use page::{Page, PageRequest, contains_literal};
pub use pool::{Db, FromDbRow, Tx};
pub use query::{Select, select};
pub use table::Table;

use crate::error::{AppError, ErrorCode, INTERNAL_UNEXPECTED};

pub const DATABASE_NEWER_THAN_APP: ErrorCode = ErrorCode::new("app.database.newer_than_app");
pub const CHECKSUM_MISMATCH: ErrorCode = ErrorCode::new("app.database.checksum_mismatch");
pub const FAILED_MIGRATION: ErrorCode = ErrorCode::new("app.database.failed_migration");
pub const UPGRADE_REQUIRED: ErrorCode = ErrorCode::new("app.database.upgrade_required");
pub const CONNECTION_FAILED: ErrorCode = ErrorCode::new("app.database.connection_failed");
pub const TLS_FAILED: ErrorCode = ErrorCode::new("app.database.tls_failed");

fn internal(source: impl std::error::Error + Send + Sync + 'static) -> AppError {
    AppError::new(INTERNAL_UNEXPECTED).with_source(source)
}

#[derive(Debug, thiserror::Error)]
enum ContractError {
    #[error("unsupported database parameter type: {0}")]
    UnsupportedValue(&'static str),
    #[error("column is managed by the framework: {0}")]
    ReservedColumn(String),
    #[error("duplicate UPDATE assignment for column: {0}")]
    DuplicateUpdateColumn(String),
    #[error("expected_version must be present exactly when optimistic locking is enabled")]
    VersionRequired,
    #[error("soft deletion is not enabled for this table")]
    SoftDeleteDisabled,
    #[error("physical deletion is not allowed for a soft-delete table")]
    PhysicalDeleteDisabled,
}

#[cfg(test)]
mod tests;

#[cfg(any(test, feature = "test-support"))]
#[expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "仅供测试与显式 test-support feature 的数据库夹具，把失败交给测试框架"
)]
pub mod test_support;

#[cfg(any(test, feature = "test-support"))]
#[expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "schema 断言仅供测试与显式 test-support feature 使用"
)]
mod schema_tests;
