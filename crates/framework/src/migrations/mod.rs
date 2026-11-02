//! framework 自身的数据库历史；运行时只嵌入锁定 SQL，定义仅用于测试与生成工具。

use crate::db::migrate;

mod snapshots;
pub use snapshots::MIGRATIONS;

#[cfg(any(test, feature = "migration-tools"))]
mod files;
#[cfg(any(test, feature = "migration-tools"))]
mod job_instance;
#[cfg(any(test, feature = "migration-tools"))]
mod jobs;
#[cfg(any(test, feature = "migration-tools"))]
mod params;
#[cfg(any(test, feature = "migration-tools"))]
mod schedules;

#[cfg(any(test, feature = "migration-tools"))]
pub fn definitions() -> Vec<migrate::snapshot::Definition> {
    vec![
        migrate::snapshot::Definition {
            info: migrate::MigrationInfo::new("framework", 1, "create_jobs"),
            statements: jobs::statements,
        },
        migrate::snapshot::Definition {
            info: migrate::MigrationInfo::new("framework", 2, "create_job_schedules"),
            statements: schedules::statements,
        },
        migrate::snapshot::Definition {
            info: migrate::MigrationInfo::new("framework", 3, "job_instance"),
            statements: job_instance::statements,
        },
        migrate::snapshot::Definition {
            info: migrate::MigrationInfo::new("framework", 4, "create_params"),
            statements: params::statements,
        },
        migrate::snapshot::Definition {
            info: migrate::MigrationInfo::new("framework", 5, "create_files"),
            statements: files::statements,
        },
    ]
}

#[cfg(test)]
mod tests;
