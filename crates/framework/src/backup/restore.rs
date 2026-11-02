//! 恢复准备只操作调用方提供的隔离副本，不打开或替换活动数据库。
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::Read,
    num::NonZeroUsize,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use sea_query::{Expr, ExprTrait, Query};
use serde::{Deserialize, Serialize};
use sqlx::Connection;

pub use super::sqlite::open_sqlite;
use super::{
    archive::{copy_hash, snapshot_entries},
    *,
};
use crate::{
    db::{Db, migrate},
    file::FileStore,
    instance::InstanceId,
};

pub const DATABASE_TIMEOUT: Duration = Duration::from_secs(120);

/// 整个恢复数据库阶段共用期限；连接重建、模块自检与解除绑定均不重置预算。
#[derive(Clone)]
pub struct DatabaseBudget {
    cancellation: Arc<Cancellation>,
    deadline: Instant,
}

impl DatabaseBudget {
    pub fn new(cancellation: Arc<Cancellation>, timeout: Duration) -> Self {
        Self {
            cancellation,
            deadline: Instant::now() + timeout,
        }
    }

    pub fn check(&self) -> Result<(), AppError> {
        self.cancellation.check()?;
        if Instant::now() >= self.deadline {
            return Err(AppError::new(RESTORE_FAILED));
        }
        Ok(())
    }
}

/// 模块在已验证的 staged 库中复用其声明默认值，不创建运行时 ParamStore 或访问凭据。
pub async fn reset_parameter(
    db: &Db,
    declaration: &crate::param::ParamDeclaration,
) -> Result<(), AppError> {
    db.execute(
        &Query::update()
            .table("fw_param")
            .value("value", declaration.default)
            .and_where(Expr::col("param_key").eq(declaration.key))
            .to_owned(),
    )
    .await
    .map_err(|_| AppError::new(RESTORE_FAILED))?;
    Ok(())
}

async fn check_schema(db: &Db) -> Result<(), AppError> {
    let executable: Option<(String,)> = db
        .fetch_optional(
            &Query::select()
                .column("name")
                .from("sqlite_schema")
                .and_where(Expr::col("type").is_in(["trigger", "view"]))
                .to_owned(),
        )
        .await
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let virtual_table: Option<(String,)> = db
        .fetch_optional(
            &Query::select()
                .column("name")
                .from("pragma_table_list")
                .and_where(Expr::col("type").is_in(["virtual", "shadow"]))
                .to_owned(),
        )
        .await
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    if executable.is_some() || virtual_table.is_some() {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    let hidden: Option<(bool,)> = db.fetch_optional(
        &Query::select().expr(Expr::cust("EXISTS (SELECT 1 FROM sqlite_schema AS s, pragma_table_xinfo(s.name) AS c WHERE s.type = 'table' AND c.hidden <> 0)")).to_owned(),
    ).await.map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    if hidden != Some((false,)) {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    Ok(())
}

async fn check_schema_definitions(
    db: &Db,
    migrations: &[migrate::Migration],
    applied: &[migrate::MigrationRecord],
    budget: &DatabaseBudget,
) -> Result<(), AppError> {
    type SchemaObject = (String, String, Option<String>);
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .in_memory(true)
        .pragma("trusted_schema", "OFF");
    let mut expected_db = sqlx::SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    let signal = budget.clone();
    expected_db
        .lock_handle()
        .await
        .map_err(|_| AppError::new(RESTORE_FAILED))?
        .set_progress_handler(1000, move || signal.check().is_ok());
    let result = async {
        for migration in migrations.iter().filter(|migration| {
            applied.iter().any(|record| {
                record.module == migration.info.module && record.version == migration.info.version
            })
        }) {
            budget.check()?;
            sqlx::raw_sql(sqlx::AssertSqlSafe(migration.sqlite))
                .execute(&mut expected_db)
                .await
                .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        }
        let mut expected: Vec<SchemaObject> =
            sqlx::query_as("SELECT type, name, sql FROM sqlite_schema")
                .fetch_all(&mut expected_db)
                .await
                .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        let query = Query::select()
            .columns(["type", "name", "sql"])
            .from("sqlite_schema")
            .to_owned();
        // 记录表由引擎自举，不在模块迁移中。只在独立内存库调用会写表的 status，
        // 取得真实定义；不复制 DDL，也不豁免 staged 记录表的 SQL 比对。
        let metadata_db = open_sqlite(":memory:", budget.clone()).await?;
        let metadata = async {
            migrate::status(&metadata_db, &[]).await?;
            metadata_db.fetch_all::<SchemaObject>(&query).await
        }
        .await;
        metadata_db.close().await;
        expected.extend(metadata.map_err(|_| AppError::new(RESTORE_FAILED))?);
        let actual = db
            .fetch_all(&query)
            .await
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        // 引擎生成的 autoindex 在两侧都有且 sql 为 NULL，无需按 sqlite_ 前缀豁免；
        // 任何额外的 sqlite_ 对象同样视为篡改。
        let definitions = |rows: Vec<SchemaObject>| {
            rows.into_iter()
                .map(|(kind, name, sql)| (kind, name, sql.map(|sql| sql.trim().to_owned())))
                .collect::<BTreeSet<_>>()
        };
        if definitions(actual) != definitions(expected) {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        Ok(())
    }
    .await;
    expected_db
        .close()
        .await
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    result
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Digest {
    pub bytes: u64,
    pub sha256: String,
}

pub fn creation_timestamp(manifest: &BackupManifest) -> Result<crate::time::Timestamp, AppError> {
    let timestamp: jiff::Timestamp = manifest
        .created_at
        .parse()
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    crate::time::Timestamp::from_millis(timestamp.as_millisecond())
        .map_err(|_| AppError::new(INVALID_ARCHIVE))
}

pub fn digest(path: &Path, limit: u64, cancel: &Cancellation) -> Result<Digest, AppError> {
    regular_path(path, false)?;
    if !fs::metadata(path)
        .map_err(|_| AppError::new(RESTORE_FAILED))?
        .is_file()
    {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    let mut file = File::open(path).map_err(|_| AppError::new(RESTORE_FAILED))?;
    if !file
        .metadata()
        .map_err(|_| AppError::new(RESTORE_FAILED))?
        .is_file()
    {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    let (bytes, sha256) = copy_hash(&mut file, &mut std::io::sink(), limit, cancel, |_| {})?;
    Ok(Digest { bytes, sha256 })
}

/// 返回归档中有界 JSON 投影的原字节；字段校验及目标配置合并由调用方负责。
pub fn read_config_projection(stage: &Path) -> Result<Vec<u8>, AppError> {
    let path = stage.join("config.json");
    regular_path(&path, false)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?
        .take(MAX_MANIFEST + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    super::archive::validate_projection(&bytes)?;
    Ok(bytes)
}

pub fn extract(
    selected: &Path,
    operation: &Path,
    product: &str,
    cancel: &Cancellation,
) -> Result<(BackupManifest, Digest), AppError> {
    regular_path(selected, false)?;
    if !fs::metadata(selected)
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?
        .is_file()
    {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    let archive = operation.join("archive.zip");
    let mut input = File::open(selected).map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let mut output = File::create_new(&archive).map_err(|_| AppError::new(RESTORE_FAILED))?;
    let (bytes, sha256) = copy_hash(
        &mut input,
        &mut output,
        MAX_TOTAL + 4 * MAX_MANIFEST,
        cancel,
        |_| {},
    )?;
    output
        .sync_all()
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    drop(output);
    let stage = operation.join("stage");
    fs::create_dir(&stage).map_err(|_| AppError::new(RESTORE_FAILED))?;
    let manifest = super::archive::read_archive(&archive, product, cancel, Some(&stage))?;
    fs::rename(stage.join("database"), stage.join("data"))
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    fs::create_dir_all(stage.join("files")).map_err(|_| AppError::new(RESTORE_FAILED))?;
    Ok((manifest, Digest { bytes, sha256 }))
}

async fn check_database(db: &Db) -> Result<(), AppError> {
    let integrity: Vec<(String,)> = db
        .fetch_all(
            &Query::select()
                .column("quick_check")
                .from("pragma_quick_check")
                .to_owned(),
        )
        .await
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let foreign: Option<(i64,)> = db
        .fetch_optional(
            &Query::select()
                .expr(Expr::val(1))
                .from("pragma_foreign_key_check")
                .to_owned(),
        )
        .await
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    if integrity != [("ok".into(),)] || foreign.is_some() {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    Ok(())
}

/// 返回是否在 stage 执行了迁移；所有数据库句柄均在返回前关闭。
pub async fn prepare_database(
    stage: &Path,
    manifest: &BackupManifest,
    migrations: &[migrate::Migration],
    target: InstanceId,
    budget: &DatabaseBudget,
) -> Result<bool, AppError> {
    let path = stage.join("data/app.db");
    regular_path(&path, false)?;
    let db = open_sqlite(&path, budget.clone()).await?;
    let result = async {
        check_schema(&db).await?;
        let report = migrate::inspect(&db, migrations)
            .await
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        report
            .ensure_upgradeable()
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        let records: Vec<_> = report
            .applied
            .iter()
            .map(|r| MigrationEntry {
                module: r.module.clone(),
                version: r.version,
                name: r.name.clone(),
                checksum: r.checksum.clone(),
                status: r.status.clone(),
            })
            .collect();
        if records != manifest.migration_records {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        check_schema_definitions(&db, migrations, &report.applied, budget).await?;
        // quick_check 会求值 CHECK；必须先拒绝同名但定义被篡改的对象。
        check_database(&db).await?;
        budget.check()?;
        db.execute(
            &Query::update()
                .table("fw_param")
                .value("secret_set", false)
                .to_owned(),
        )
        .await
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        let requires_upgrade = !report.pending.is_empty();
        if requires_upgrade {
            migrate::startup(&db, migrations, stage, NonZeroUsize::MIN)
                .await
                .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        }
        budget.check()?;
        check_quiescent(&db).await?;
        FileStore::rebind_restored_instance(&db, &manifest.source_instance_id, target)
            .await
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        let files = FileStore::new(db.clone(), stage, target, 20, &[]);
        let actual = snapshot_entries(&files, &db).await?;
        let expected: BTreeMap<_, _> = manifest
            .entries
            .iter()
            .filter(|entry| entry.path.starts_with("files/"))
            .map(|entry| (entry.path.as_str(), (entry.bytes, entry.sha256.as_str())))
            .collect();
        if expected.len() != actual.len() {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        for entry in actual {
            if expected.get(entry.path.as_str()) != Some(&(entry.bytes, entry.sha256.as_str())) {
                return Err(AppError::new(INVALID_ARCHIVE));
            }
            let actual = digest(&stage.join(&entry.path), MAX_FILE, &budget.cancellation)?;
            if actual.bytes != entry.bytes || actual.sha256 != entry.sha256 {
                return Err(AppError::new(HASH_MISMATCH));
            }
        }
        check_database(&db).await?;
        Ok(requires_upgrade)
    }
    .await;
    db.close().await;
    budget.check()?;
    result
}

/// 暂存库、原始 JSON 投影及附件的摘要；调用方另为合并后的应用配置生成摘要。
/// 升级快照、原始包和验证材料仍留在操作目录。
pub fn stage_digests(
    stage: &Path,
    cancel: &Cancellation,
) -> Result<BTreeMap<String, Digest>, AppError> {
    // 池关闭后仍有未检查点的页面就不能仅切换主文件。
    let wal = stage.join("data/app.db-wal");
    regular_path(&wal, true)?;
    match fs::metadata(wal) {
        Ok(metadata) if metadata.len() == 0 => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err(AppError::new(INVALID_ARCHIVE)),
    }
    let mut entries = BTreeMap::new();
    for (name, limit) in [("data/app.db", MAX_DATABASE), ("config.json", MAX_MANIFEST)] {
        entries.insert(name.into(), digest(&stage.join(name), limit, cancel)?);
    }
    let mut bytes: u64 = entries.values().map(|entry| entry.bytes).sum();
    collect_files(
        stage,
        &stage.join("files"),
        &mut entries,
        &mut bytes,
        cancel,
    )?;
    if entries.len() + 1 > MAX_ENTRIES || bytes > MAX_TOTAL {
        return Err(AppError::new(TOO_LARGE));
    }
    Ok(entries)
}

/// 只读收集附件摘要，沿用归档路径、深度、单文件及总量预算。
/// root/directory 必须是同一恢复树的根与 files 目录；entries/total 含已计入的对象。
pub fn collect_files(
    root: &Path,
    directory: &Path,
    entries: &mut BTreeMap<String, Digest>,
    total: &mut u64,
    cancel: &Cancellation,
) -> Result<(), AppError> {
    regular_path(directory, false)?;
    for entry in fs::read_dir(directory).map_err(|_| AppError::new(RESTORE_FAILED))? {
        cancel.check()?;
        let path: PathBuf = entry.map_err(|_| AppError::new(RESTORE_FAILED))?.path();
        regular_path(&path, false)?;
        if path.is_dir() {
            if path
                .strip_prefix(root)
                .map_err(|_| AppError::new(INVALID_ARCHIVE))?
                .components()
                .count()
                > 3
            {
                return Err(AppError::new(INVALID_ARCHIVE));
            }
            collect_files(root, &path, entries, total, cancel)?;
        } else {
            let name = path
                .strip_prefix(root)
                .map_err(|_| AppError::new(INVALID_ARCHIVE))?
                .to_string_lossy()
                .replace('\\', "/");
            super::manifest::entry_limit(&name)?;
            let entry = digest(&path, std::cmp::min(MAX_FILE, MAX_TOTAL - *total), cancel)?;
            *total += entry.bytes;
            entries.insert(name, entry);
            if entries.len() + 1 > MAX_ENTRIES {
                return Err(AppError::new(TOO_LARGE));
            }
        }
    }
    Ok(())
}
