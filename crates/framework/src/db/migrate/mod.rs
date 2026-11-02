//! 运行时只接受快照；记录表自举不占用模块迁移版本。

mod backup;
mod lock;
#[cfg(any(test, feature = "migration-tools"))]
pub mod snapshot;

use std::{collections::BTreeMap, io, num::NonZeroUsize, path::Path, time::Instant};

use sea_query::{
    ColumnDef, Expr, ExprTrait, Index, InsertStatement, Order, Query, Table, TableCreateStatement,
    UpdateStatement,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{
    CHECKSUM_MISMATCH, DATABASE_NEWER_THAN_APP, Db, FAILED_MIGRATION, UPGRADE_REQUIRED, internal,
    pool::Connection,
};
use crate::{error::AppError, time::Timestamp};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dialect {
    Sqlite,
    Mysql,
    Postgres,
}

impl Dialect {
    pub const ALL: [Self; 3] = [Self::Sqlite, Self::Mysql, Self::Postgres];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sqlite => "sqlite",
            Self::Mysql => "mysql",
            Self::Postgres => "postgres",
        }
    }
}

impl std::str::FromStr for Dialect {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "sqlite" => Ok(Self::Sqlite),
            "mysql" => Ok(Self::Mysql),
            "postgres" => Ok(Self::Postgres),
            _ => Err("dialect must be sqlite, mysql or postgres".into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct MigrationInfo {
    pub module: &'static str,
    pub version: u32,
    pub name: &'static str,
    pub transactional: bool,
}

impl MigrationInfo {
    pub const fn new(module: &'static str, version: u32, name: &'static str) -> Self {
        Self {
            module,
            version,
            name,
            transactional: true,
        }
    }

    pub const fn non_transactional(mut self) -> Self {
        self.transactional = false;
        self
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Migration {
    pub info: MigrationInfo,
    pub sqlite: &'static str,
    pub mysql: &'static str,
    pub postgres: &'static str,
}

impl Migration {
    pub fn sql(&self, dialect: Dialect) -> &'static str {
        match dialect {
            Dialect::Sqlite => self.sqlite,
            Dialect::Mysql => self.mysql,
            Dialect::Postgres => self.postgres,
        }
    }
}

pub fn checksum(sql: &[u8]) -> String {
    format!("{:x}", Sha256::digest(sql))
}

// 元数据来自程序注册，校验连续版本与可安全用作快照路径的标识符。
pub(crate) fn validate_registry(
    infos: impl IntoIterator<Item = MigrationInfo>,
) -> Result<(), AppError> {
    let mut versions = BTreeMap::new();
    for info in infos {
        let module_valid = info.module.starts_with(|c: char| c.is_ascii_lowercase())
            && info
                .module
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-');
        let name_valid = info.name.starts_with(|c: char| c.is_ascii_lowercase())
            && info.name.split('_').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            });
        let previous = versions.entry(info.module).or_insert(0);
        if !module_valid || !name_valid || info.version != *previous + 1 {
            return Err(internal(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid migration metadata or non-contiguous version: {info:?}"),
            )));
        }
        *previous = info.version;
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
pub struct MigrationRecord {
    pub module: String,
    #[sqlx(try_from = "i64")]
    pub version: u32,
    pub name: String,
    pub checksum: String,
    pub status: String,
    pub applied_at: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct ChecksumMismatch {
    pub record: MigrationRecord,
    pub expected_checksum: String,
}

#[derive(Debug, Default, Serialize)]
pub struct MigrationStatus {
    pub applied: Vec<MigrationRecord>,
    pub pending: Vec<MigrationInfo>,
    pub unknown: Vec<MigrationRecord>,
    pub checksum_mismatch: Vec<ChecksumMismatch>,
    /// failed 与中断留下的 running 都必须人工核对，不能自动重跑。
    pub failed: Vec<MigrationRecord>,
}

impl MigrationStatus {
    pub fn ensure_upgradeable(&self) -> Result<(), AppError> {
        let (code, records) = if !self.unknown.is_empty() {
            (
                DATABASE_NEWER_THAN_APP,
                self.unknown.iter().collect::<Vec<_>>(),
            )
        } else if !self.checksum_mismatch.is_empty() {
            (
                CHECKSUM_MISMATCH,
                self.checksum_mismatch
                    .iter()
                    .map(|item| &item.record)
                    .collect(),
            )
        } else if !self.failed.is_empty() {
            (FAILED_MIGRATION, self.failed.iter().collect())
        } else {
            return Ok(());
        };
        let migrations = records
            .iter()
            .map(|record| format!("{}:{}:{}", record.module, record.version, record.name))
            .collect::<Vec<_>>()
            .join(", ");
        Err(AppError::new(code).with_param("migrations", migrations))
    }
}

/// 建表定义的统一入口；sea-query 的通用渲染器不会自动过滤 MySQL 选项。
pub fn create_table(dialect: Dialect, name: &str) -> TableCreateStatement {
    let mut table = Table::create();
    table.table(sea_query::Alias::new(name));
    if dialect == Dialect::Mysql {
        table
            .engine("InnoDB")
            .character_set("utf8mb4")
            .collate("utf8mb4_bin");
    }
    table
}

fn bootstrap(dialect: Dialect) -> String {
    let table = create_table(dialect, "fw_schema_migration")
        .if_not_exists()
        .col(ColumnDef::new("module").string_len(128).not_null())
        .col(ColumnDef::new("version").big_integer().not_null())
        .col(ColumnDef::new("name").string_len(255).not_null())
        .col(ColumnDef::new("checksum").string_len(64).not_null())
        .col(ColumnDef::new("status").string_len(16).not_null())
        .col(ColumnDef::new("applied_at").big_integer().not_null())
        .col(ColumnDef::new("duration_ms").big_integer().not_null())
        .primary_key(Index::create().col("module").col("version"))
        .check(Expr::col("status").is_in(["running", "succeeded", "failed"]))
        .to_owned();
    match dialect {
        Dialect::Sqlite => table.build(sea_query::SqliteQueryBuilder),
        Dialect::Mysql => table.build(sea_query::MysqlQueryBuilder),
        Dialect::Postgres => table.build(sea_query::PostgresQueryBuilder),
    }
}

pub async fn status(db: &Db, migrations: &[Migration]) -> Result<MigrationStatus, AppError> {
    let mut connection = lock::acquire(db, 30).await?;
    let result = read_status(&mut connection, db.dialect(), migrations).await;
    let released = lock::release(&mut connection).await;
    let report = result?;
    released?;
    Ok(report)
}

/// 验证已有归档时不创建记录表，也不取得会写入数据库的迁移锁。
pub async fn inspect(db: &Db, migrations: &[Migration]) -> Result<MigrationStatus, AppError> {
    validate_registry(migrations.iter().map(|migration| migration.info))?;
    let records = db.fetch_all(&records_query()).await?;
    Ok(classify(db.dialect(), migrations, records))
}

fn records_query() -> sea_query::SelectStatement {
    Query::select()
        .columns([
            "module",
            "version",
            "name",
            "checksum",
            "status",
            "applied_at",
            "duration_ms",
        ])
        .from("fw_schema_migration")
        .order_by("module", Order::Asc)
        .order_by("version", Order::Asc)
        .to_owned()
}

async fn read_status(
    connection: &mut Connection,
    dialect: Dialect,
    migrations: &[Migration],
) -> Result<MigrationStatus, AppError> {
    validate_registry(migrations.iter().map(|migration| migration.info))?;
    connection.raw(&bootstrap(dialect)).await?;
    let records = connection.fetch_all(&records_query()).await?;
    Ok(classify(dialect, migrations, records))
}

fn classify(
    dialect: Dialect,
    migrations: &[Migration],
    records: Vec<MigrationRecord>,
) -> MigrationStatus {
    let mut report = MigrationStatus::default();
    for record in &records {
        if record.status != "succeeded" {
            report.failed.push(record.clone());
        }
        match migrations.iter().find(|migration| {
            migration.info.module == record.module && migration.info.version == record.version
        }) {
            None => report.unknown.push(record.clone()),
            Some(migration) => {
                let expected_checksum = checksum(migration.sql(dialect).as_bytes());
                if record.checksum != expected_checksum || record.name != migration.info.name {
                    report.checksum_mismatch.push(ChecksumMismatch {
                        record: record.clone(),
                        expected_checksum,
                    });
                } else if record.status == "succeeded" {
                    report.applied.push(record.clone());
                }
            }
        }
    }
    report.pending = migrations
        .iter()
        .filter(|migration| {
            !records.iter().any(|record| {
                record.module == migration.info.module && record.version == migration.info.version
            })
        })
        .map(|migration| migration.info)
        .collect();
    report
}

/// 启动入口：SQLite 备份后升级；远端数据库只检查，升级必须显式触发。
pub async fn startup(
    db: &Db,
    migrations: &[Migration],
    state_root: &Path,
    backup_keep: NonZeroUsize,
) -> Result<MigrationStatus, AppError> {
    if db.dialect() == Dialect::Sqlite {
        return upgrade(
            db,
            migrations,
            UpgradeBackup::Sqlite {
                state_root,
                keep: backup_keep,
            },
        )
        .await;
    }
    let report = status(db, migrations).await?;
    report.ensure_upgradeable()?;
    if !report.pending.is_empty() {
        return Err(AppError::new(UPGRADE_REQUIRED));
    }
    Ok(report)
}

/// SQLite 自动备份；远端库由调用方显式确认已经自行备份。
pub enum UpgradeBackup<'a> {
    Sqlite {
        state_root: &'a Path,
        keep: NonZeroUsize,
    },
    Confirmed,
}

/// 显式升级入口；备份方式必须与数据库方言一致。
pub async fn upgrade(
    db: &Db,
    migrations: &[Migration],
    backup: UpgradeBackup<'_>,
) -> Result<MigrationStatus, AppError> {
    if (db.dialect() == Dialect::Sqlite) != matches!(backup, UpgradeBackup::Sqlite { .. }) {
        return Err(internal(io::Error::new(
            io::ErrorKind::InvalidInput,
            "SQLite requires an automatic backup; remote upgrades require backup confirmation",
        )));
    }
    let mut connection = lock::acquire(db, 30).await?;
    let result = upgrade_locked(&mut connection, db.dialect(), migrations, backup).await;
    let released = lock::release(&mut connection).await;
    let report = result?;
    released?;
    Ok(report)
}

async fn upgrade_locked(
    connection: &mut Connection,
    dialect: Dialect,
    migrations: &[Migration],
    backup: UpgradeBackup<'_>,
) -> Result<MigrationStatus, AppError> {
    // 必须在取得锁之后读取待迁移列表，防止等待期间另一进程已经升级。
    let report = read_status(connection, dialect, migrations).await?;
    report.ensure_upgradeable()?;
    if report.pending.is_empty() {
        return Ok(report);
    }
    if let (Connection::Sqlite(sqlite), UpgradeBackup::Sqlite { state_root, keep }) =
        (&mut *connection, backup)
    {
        backup::create(sqlite, state_root, keep).await?;
    }
    for migration in migrations {
        if report.pending.iter().any(|info| {
            info.module == migration.info.module && info.version == migration.info.version
        }) {
            apply(connection, dialect, migration).await?;
        }
    }
    read_status(connection, dialect, migrations).await
}

fn record_running(migration: &Migration, dialect: Dialect) -> InsertStatement {
    Query::insert()
        .into_table("fw_schema_migration")
        .columns([
            "module",
            "version",
            "name",
            "checksum",
            "status",
            "applied_at",
            "duration_ms",
        ])
        .values_panic([
            migration.info.module.into(),
            i64::from(migration.info.version).into(),
            migration.info.name.into(),
            checksum(migration.sql(dialect).as_bytes()).into(),
            "running".into(),
            Timestamp::now().as_millis().into(),
            0_i64.into(),
        ])
        .to_owned()
}

fn finish(
    migration: &Migration,
    state: &str,
    started: Instant,
) -> Result<UpdateStatement, AppError> {
    Ok(Query::update()
        .table("fw_schema_migration")
        .value("status", state)
        .value(
            "duration_ms",
            i64::try_from(started.elapsed().as_millis()).map_err(internal)?,
        )
        .and_where(Expr::col("module").eq(migration.info.module))
        .and_where(Expr::col("version").eq(i64::from(migration.info.version)))
        .to_owned())
}

async fn apply(
    connection: &mut Connection,
    dialect: Dialect,
    migration: &Migration,
) -> Result<(), AppError> {
    let started = Instant::now();
    let failure = |source| {
        AppError::new(FAILED_MIGRATION)
            .with_param(
                "migrations",
                format!(
                    "{}:{}:{}",
                    migration.info.module, migration.info.version, migration.info.name
                ),
            )
            .with_source(source)
    };
    if migration.info.transactional && dialect != Dialect::Mysql {
        let mut transaction = connection.begin().await?;
        transaction
            .execute(&record_running(migration, dialect))
            .await?;
        if let Err(source) = transaction.raw(migration.sql(dialect)).await {
            transaction.rollback().await?;
            return Err(failure(source));
        }
        transaction
            .execute(&finish(migration, "succeeded", started)?)
            .await?;
        transaction.commit().await?;
    } else {
        connection
            .execute(&record_running(migration, dialect))
            .await?;
        match connection.raw(migration.sql(dialect)).await {
            Ok(()) => {
                connection
                    .execute(&finish(migration, "succeeded", started)?)
                    .await?;
            }
            Err(source) => {
                connection
                    .execute(&finish(migration, "failed", started)?)
                    .await?;
                return Err(failure(source));
            }
        }
    }
    tracing::info!(
        module = migration.info.module,
        version = migration.info.version,
        name = migration.info.name,
        "数据库迁移完成"
    );
    Ok(())
}

/// 保留注册顺序及快照内容；仅在文件之间插入换行。
pub fn export_sql(migrations: &[Migration], dialect: Dialect) -> Result<String, AppError> {
    validate_registry(migrations.iter().map(|migration| migration.info))?;
    Ok(migrations
        .iter()
        .map(|migration| migration.sql(dialect))
        .collect::<Vec<_>>()
        .join("\n"))
}

#[cfg(test)]
pub(super) mod tests;
