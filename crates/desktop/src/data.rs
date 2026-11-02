//! 备份操作与一次性恢复会话；宿主持有身份/准入及配置读锁，解析文件令牌并提供模块校验。
//! 恢复含同步文件校验，宿主应在阻塞工作线程驱动恢复 future；重启须等命令记录和完整关闭完成。

use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Serialize;
use sha2::{Digest as _, Sha256};
use tenon_framework::{
    backup::{self, Cancellation, restore as staging},
    cache::CacheProvider,
    db::{
        DatabaseKind, Db,
        migrate::{Dialect, Migration},
    },
    error::{AppError, INPUT_INVALID, INTERNAL_UNEXPECTED, PERMISSION_DENIED},
    file::FileStore,
    instance::InstanceId,
    maintenance::OPERATION_BUSY,
    stream::StreamOwner,
    time::Timestamp,
};
use ts_rs::TS;

use crate::{
    config::{self, ConfigSource, LoadedConfig},
    restore,
};

#[derive(Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OperationPhase {
    Preparing,
    Snapshotting,
    Copying,
    Verifying,
    Archiving,
    Downloading,
    Ready,
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgress {
    pub operation_id: String,
    pub phase: OperationPhase,
    #[ts(type = "number | null")]
    pub current: Option<u64>,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
    pub unit: OperationUnit,
    pub can_cancel: bool,
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum OperationUnit {
    Bytes,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileArtifact {
    #[ts(type = "number")]
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DataStatus {
    pub can_manage: bool,
    pub availability: DataAvailability,
    pub operation: Option<OperationStatus>,
    pub last_restore: Option<restore::RestoreResult>,
}

/// 状态查询不返回取消令牌；operationId 只发给发起方的观察回调。
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OperationStatus {
    pub phase: OperationPhase,
    pub can_cancel: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DataAvailability {
    Sqlite,
    RemoteDatabase,
    UnsupportedStorage,
    UnsupportedCache,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlan {
    pub prepared_id: String,
    pub product_id: String,
    pub app_version: String,
    pub created_at: Timestamp,
    pub entries: usize,
    #[ts(type = "number")]
    pub total_bytes: u64,
    pub requires_upgrade: bool,
    #[ts(type = "true")]
    pub excludes_secrets: bool,
    #[ts(type = "false")]
    pub encrypted: bool,
    #[ts(type = "true")]
    pub requires_restart: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAccepted {
    pub operation_id: String,
    #[ts(type = "true")]
    pub restart_required: bool,
}

/// 宿主已验证活动 owner/main，且维持授权、准入与配置锁至调用结束。
pub struct RestoreTarget<'a> {
    pub owner: StreamOwner,
    pub config: &'a LoadedConfig,
    pub instance: InstanceId,
}

pub struct RestoreInput {
    pub selected: PathBuf,
    pub product_id: String,
    /// 全部编译模块的迁移，包含停用模块；由宿主装配。
    pub migrations: Vec<Migration>,
}

pub struct ExportInput {
    pub destination: PathBuf,
    pub files: FileStore,
    pub product_id: String,
    pub migrations: Vec<Migration>,
}

/// 仅连接发起方；观察端失联不取消工作，宿主可忽略发送错误。
pub type ProgressObserver = Arc<dyn Fn(OperationProgress) + Send + Sync>;

struct Prepared {
    id: String,
    owner: StreamOwner,
    expires: Instant,
    directory: tempfile::TempDir,
    root: String,
    instance: InstanceId,
    config: Option<staging::Digest>,
    archive: staging::Digest,
    members: BTreeMap<String, staging::Digest>,
}

struct Operation {
    id: String,
    cancellation: Arc<Cancellation>,
    progress: Mutex<OperationProgress>,
}

pub struct DataService {
    db: Db,
    root: PathBuf,
    scratch: PathBuf,
    restore_scratch: PathBuf,
    operation: Arc<Mutex<Option<Arc<Operation>>>>,
    prepared: Mutex<Option<Prepared>>,
}

struct Registration {
    active: Arc<Mutex<Option<Arc<Operation>>>>,
    operation: Arc<Operation>,
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.operation.cancellation.cancel();
        // 仅资源回收时取回中毒锁；后续入口仍会将中毒报告为内部错误。
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if active
            .as_ref()
            .is_some_and(|op| Arc::ptr_eq(op, &self.operation))
        {
            active.take();
        }
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError::new(INTERNAL_UNEXPECTED)
}

impl DataService {
    pub fn new(db: Db, root: PathBuf, scratch: PathBuf, restore_scratch: PathBuf) -> Self {
        Self {
            db,
            root,
            scratch,
            restore_scratch,
            operation: Arc::default(),
            prepared: Mutex::default(),
        }
    }

    /// can_manage 由宿主授权结果提供；不查询业务身份，也不主动探测远程服务。
    pub fn status(&self, can_manage: bool, config: &LoadedConfig) -> Result<DataStatus, AppError> {
        let availability = if self.db.dialect() != Dialect::Sqlite {
            DataAvailability::RemoteDatabase
        } else if backup::check_layout(&self.root, &self.scratch).is_err()
            || restore::check_layout(&self.root, &self.restore_scratch).is_err()
        {
            DataAvailability::UnsupportedStorage
        } else if config.cache().provider() != CacheProvider::Local {
            DataAvailability::UnsupportedCache
        } else {
            DataAvailability::Sqlite
        };
        let active = self.operation.lock().map_err(lock_error)?.clone();
        let operation = active
            .map(|op| -> Result<_, AppError> {
                Ok(OperationStatus {
                    phase: op.progress.lock().map_err(lock_error)?.phase,
                    can_cancel: op.cancellation.can_cancel(),
                })
            })
            .transpose()?;
        Ok(DataStatus {
            can_manage,
            availability,
            operation,
            last_restore: restore::last_result(&self.root)?,
        })
    }

    fn check_restore_target(&self, target: &RestoreTarget<'_>) -> Result<(), AppError> {
        if target.owner.scope != "main" {
            return Err(AppError::new(PERMISSION_DENIED));
        }
        if self.db.dialect() != Dialect::Sqlite
            || target.config.database().kind() != DatabaseKind::Sqlite
        {
            return Err(AppError::new(backup::UNSUPPORTED_DATABASE));
        }
        if target.config.cache().provider() != CacheProvider::Local {
            return Err(AppError::new(backup::UNSUPPORTED_CACHE));
        }
        let expected = format!("{}\n", target.instance);
        let instance = staging::digest(
            &self.root.join("instance-id"),
            128,
            &Cancellation::default(),
        )?;
        if instance.sha256 != format!("{:x}", Sha256::digest(expected.as_bytes())) {
            return Err(AppError::new(backup::RESTORE_FAILED));
        }
        restore::check_layout(&self.root, &self.restore_scratch)?;
        for source in [ConfigSource::Environment, ConfigSource::CommandLine] {
            if target
                .config
                .source_keys(source)
                .iter()
                .any(|key| related_override(key))
            {
                return Err(AppError::new(config::SETTINGS_OVERRIDDEN).with_param("key", "restore"));
            }
        }
        Ok(())
    }

    /// validate_config 校验合并后的模块启用表；prepare_modules 顺序执行口令哈希检查与凭据解绑。
    /// 两个回调均必填；数据库回调只收到已通过 framework schema 校验的隔离库。
    pub async fn prepare_restore(
        &self,
        target: RestoreTarget<'_>,
        input: RestoreInput,
        observer: ProgressObserver,
        validate_config: impl FnOnce(&LoadedConfig) -> Result<(), AppError>,
        prepare_modules: impl AsyncFnOnce(&Db) -> Result<(), AppError>,
    ) -> Result<RestorePlan, AppError> {
        self.check_restore_target(&target)?;
        let registration = self.register()?;
        let op = &registration.operation;
        let initial = op.progress.lock().map_err(lock_error)?.clone();
        observer(initial);
        let original_config = config_digest(&self.root)?;
        self.prepared.lock().map_err(lock_error)?.take();
        let directory = tempfile::Builder::new()
            .prefix(&format!("{}-", op.id))
            .tempdir_in(&self.restore_scratch)
            .map_err(|_| AppError::new(backup::RESTORE_FAILED))?;
        let (manifest, archive) = staging::extract(
            &input.selected,
            directory.path(),
            &input.product_id,
            &op.cancellation,
        )?;
        let stage = directory.path().join("stage");
        let projection: config::BackupConfig =
            serde_json::from_slice(&staging::read_config_projection(&stage)?)
                .map_err(|_| AppError::new(backup::INVALID_ARCHIVE))?;
        let merged = config::merge_backup(&self.root, &projection)
            .map_err(|_| AppError::new(backup::INVALID_ARCHIVE))?;
        if merged.len() as u64 > backup::MAX_MANIFEST {
            return Err(AppError::new(backup::TOO_LARGE));
        }
        let mut file = File::create_new(stage.join("config.toml"))
            .map_err(|_| AppError::new(backup::RESTORE_FAILED))?;
        file.write_all(merged.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|_| AppError::new(backup::RESTORE_FAILED))?;
        drop(file);
        let merged_config =
            config::load(&stage, [], &[]).map_err(|_| AppError::new(backup::INVALID_ARCHIVE))?;
        validate_config(&merged_config)?;
        report(
            op,
            &observer,
            OperationPhase::Verifying,
            Some(manifest.total_bytes),
            Some(manifest.total_bytes),
        )?;
        let budget =
            staging::DatabaseBudget::new(op.cancellation.clone(), staging::DATABASE_TIMEOUT);
        let requires_upgrade = staging::prepare_database(
            &stage,
            &manifest,
            &input.migrations,
            target.instance,
            &budget,
        )
        .await?;
        let db = staging::open_sqlite(stage.join("data/app.db"), budget.clone()).await?;
        let modules = prepare_modules(&db).await;
        db.close().await;
        budget.check()?;
        modules?;
        let members = prepared_digests(&stage, &op.cancellation)?;
        let created_at = staging::creation_timestamp(&manifest)?;
        let root = restore::path_digest(&self.root)?;
        op.cancellation.commit()?;
        let plan = RestorePlan {
            prepared_id: op.id.clone(),
            product_id: manifest.product_id,
            app_version: manifest.app_version,
            created_at,
            entries: manifest.entries.len(),
            total_bytes: manifest.total_bytes,
            requires_upgrade,
            excludes_secrets: true,
            encrypted: false,
            requires_restart: true,
        };
        *self.prepared.lock().map_err(lock_error)? = Some(Prepared {
            id: op.id.clone(),
            owner: target.owner,
            expires: Instant::now() + Duration::from_secs(600),
            directory,
            root,
            instance: target.instance,
            config: original_config,
            archive,
            members,
        });
        Ok(plan)
    }

    /// 宿主持有维护独占；journal 落盘后关闭准入，随后由宿主等待命令记录、关闭和受控重启。
    pub async fn commit_restore(
        &self,
        target: RestoreTarget<'_>,
        id: &str,
        close_admission: impl FnOnce(),
    ) -> Result<RestoreAccepted, AppError> {
        self.check_restore_target(&target)?;
        let _registration = self.register()?;
        let prepared = self.consume_prepared(&target, id)?;
        backup::check_quiescent(&self.db).await?;
        let cancel = Cancellation::default();
        if staging::digest(
            &prepared.directory.path().join("archive.zip"),
            backup::MAX_TOTAL + 4 * backup::MAX_MANIFEST,
            &cancel,
        )? != prepared.archive
            || prepared_digests(&prepared.directory.path().join("stage"), &cancel)?
                != prepared.members
        {
            return Err(AppError::new(backup::HASH_MISMATCH));
        }
        // 大归档校验期间可能经过期限或发生文件变化；落 journal 前再核对目标绑定。
        check_prepared(&prepared, &target, id, &self.root)?;
        let path = self.restore_scratch.join(&prepared.id);
        backup::regular_path(&path, true)?;
        if path
            .try_exists()
            .map_err(|_| AppError::new(backup::RESTORE_FAILED))?
        {
            return Err(AppError::new(backup::RESTORE_FAILED));
        }
        fs::rename(prepared.directory.path(), &path)
            .map_err(|_| AppError::new(backup::RESTORE_FAILED))?;
        let _ = prepared.directory.keep();
        let mut members = prepared.members;
        members.remove("config.json");
        restore::record(&self.root, &self.restore_scratch, &prepared.id, members)?;
        close_admission();
        Ok(RestoreAccepted {
            operation_id: prepared.id,
            restart_required: true,
        })
    }

    fn consume_prepared(&self, target: &RestoreTarget<'_>, id: &str) -> Result<Prepared, AppError> {
        let prepared = self
            .prepared
            .lock()
            .map_err(lock_error)?
            .take()
            .ok_or_else(|| AppError::new(backup::RESTORE_EXPIRED))?;
        check_prepared(&prepared, target, id, &self.root)?;
        Ok(prepared)
    }

    fn register(&self) -> Result<Arc<Registration>, AppError> {
        let id = operation_id();
        let op = Arc::new(Operation {
            id: id.clone(),
            cancellation: Arc::default(),
            progress: Mutex::new(OperationProgress {
                operation_id: id,
                phase: OperationPhase::Preparing,
                current: None,
                total: None,
                unit: OperationUnit::Bytes,
                can_cancel: true,
            }),
        });
        let mut active = self.operation.lock().map_err(lock_error)?;
        if active.is_some() {
            return Err(AppError::new(OPERATION_BUSY));
        }
        *active = Some(op.clone());
        Ok(Arc::new(Registration {
            active: self.operation.clone(),
            operation: op,
        }))
    }

    /// 只访问内存；未知和结束的合法令牌幂等，提交边界之后取消无效。
    pub fn cancel(&self, id: &str) -> Result<(), AppError> {
        validate_operation_id(id)?;
        if let Some(op) = self.operation.lock().map_err(lock_error)?.as_ref()
            && op.id == id
        {
            op.cancellation.cancel();
        }
        Ok(())
    }

    /// 调用方已授权活动 owner/main，并持有备份维护独占和配置读锁。
    pub async fn export(
        &self,
        input: ExportInput,
        observer: ProgressObserver,
    ) -> Result<FileArtifact, AppError> {
        if self.db.dialect() != Dialect::Sqlite {
            return Err(AppError::new(backup::UNSUPPORTED_DATABASE));
        }
        let registration = self.register()?;
        let op = registration.operation.clone();
        let initial = op.progress.lock().map_err(lock_error)?.clone();
        observer(initial);
        backup::check_quiescent(&self.db).await?;
        let projection =
            config::project_backup(&self.root).map_err(|_| AppError::new(backup::EXPORT_FAILED))?;
        let config_projection =
            serde_json::to_vec(&projection).map_err(|_| AppError::new(backup::EXPORT_FAILED))?;
        let progress_observer = observer.clone();
        // framework 的 blocking worker 持有此回调，future 被丢弃也不能提前释放单操作槽。
        let progress: backup::Progress = Arc::new(move |phase, current, total| {
            let phase = match phase {
                backup::Phase::Snapshotting => OperationPhase::Snapshotting,
                backup::Phase::Copying => OperationPhase::Copying,
                backup::Phase::Verifying => OperationPhase::Verifying,
                backup::Phase::Archiving => OperationPhase::Archiving,
            };
            if report(
                &registration.operation,
                &progress_observer,
                phase,
                Some(current),
                total,
            )
            .is_err()
            {
                registration.operation.cancellation.cancel();
            }
        });
        let result = backup::export(
            backup::BackupInput {
                db: self.db.clone(),
                files: input.files,
                state_root: self.root.clone(),
                scratch: self.scratch.clone(),
                destination: input.destination,
                config_projection,
                product_id: input.product_id,
                app_version: env!("CARGO_PKG_VERSION").into(),
                migrations: input.migrations,
            },
            op.cancellation.clone(),
            progress,
        )
        .await;
        // progress 回调无法返回错误；这里明确报告锁中毒，不把内部错误伪装成用户取消。
        drop(op.progress.lock().map_err(lock_error)?);
        let (bytes, sha256) = result?;
        report(
            &op,
            &observer,
            OperationPhase::Ready,
            Some(bytes),
            Some(bytes),
        )?;
        Ok(FileArtifact { bytes, sha256 })
    }
}

fn report(
    op: &Operation,
    observer: &ProgressObserver,
    phase: OperationPhase,
    current: Option<u64>,
    total: Option<u64>,
) -> Result<(), AppError> {
    let progress = OperationProgress {
        operation_id: op.id.clone(),
        phase,
        current,
        total,
        unit: OperationUnit::Bytes,
        can_cancel: op.cancellation.can_cancel(),
    };
    *op.progress.lock().map_err(lock_error)? = progress.clone();
    observer(progress);
    Ok(())
}

fn related_override(key: &str) -> bool {
    key != "ui.developer_mode"
        && key.split('.').next().is_some_and(|section| {
            matches!(
                section,
                "ui" | "auth" | "modules" | "jobs" | "logging" | "notify" | "database" | "cache"
            )
        })
}

fn check_prepared(
    prepared: &Prepared,
    target: &RestoreTarget<'_>,
    id: &str,
    root: &Path,
) -> Result<(), AppError> {
    if prepared.id != id
        || prepared.owner != target.owner
        || target.owner.scope != "main"
        || prepared.instance != target.instance
        || prepared.expires <= Instant::now()
        || prepared.root != restore::path_digest(root)?
        || prepared.config != config_digest(root)?
    {
        return Err(AppError::new(backup::RESTORE_EXPIRED));
    }
    Ok(())
}

fn config_digest(root: &Path) -> Result<Option<staging::Digest>, AppError> {
    let path = root.join("config.toml");
    backup::regular_path(&path, true)?;
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(AppError::new(backup::RESTORE_FAILED)),
        Ok(_) => staging::digest(&path, backup::MAX_MANIFEST, &Cancellation::default()).map(Some),
    }
}

fn prepared_digests(
    stage: &Path,
    cancel: &Cancellation,
) -> Result<BTreeMap<String, staging::Digest>, AppError> {
    let mut members = staging::stage_digests(stage, cancel)?;
    members.insert(
        "config.toml".into(),
        staging::digest(&stage.join("config.toml"), backup::MAX_MANIFEST, cancel)?,
    );
    Ok(members)
}

pub fn validate_operation_id(id: &str) -> Result<(), AppError> {
    if !restore::valid_id(id) {
        return Err(AppError::new(INPUT_INVALID).with_param("path", "operationId"));
    }
    Ok(())
}

fn operation_id() -> String {
    // 保留两次 OS CSPRNG 抽样中的 128 个随机位，排除 UUID version/variant 固定位。
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();
    let mut bytes = [0_u8; 16];
    bytes[..6].copy_from_slice(&a.as_bytes()[..6]);
    bytes[6..13].copy_from_slice(&a.as_bytes()[9..]);
    bytes[13..].copy_from_slice(&b.as_bytes()[..3]);
    uuid::Uuid::from_bytes(bytes).simple().to_string()
}

#[cfg(test)]
mod tests;
