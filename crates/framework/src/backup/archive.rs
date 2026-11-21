use super::{
    manifest::{EXCLUDED, entry_limit},
    *,
};
use crate::{
    db::{
        Db,
        migrate::{self, Dialect, Migration},
    },
    file::{FileStore, SnapshotEntry},
};
use sea_query::{Expr, ExprTrait, Query};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

pub struct BackupInput {
    pub db: Db,
    pub files: FileStore,
    pub state_root: PathBuf,
    pub scratch: PathBuf,
    pub destination: PathBuf,
    /// 调用方生成的 JSON 文档，原字节保存；格式版本由文档自身声明。
    pub config_projection: Vec<u8>,
    pub product_id: String,
    pub app_version: String,
    pub migrations: Vec<Migration>,
}

#[derive(Clone, Copy)]
pub enum Phase {
    Snapshotting,
    Copying,
    Verifying,
    Archiving,
}

pub type Progress = Arc<dyn Fn(Phase, u64, Option<u64>) + Send + Sync>;

pub(super) fn validate_projection(bytes: &[u8]) -> Result<(), AppError> {
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err(AppError::new(TOO_LARGE));
    }
    serde_json::from_slice::<serde_json::Value>(bytes)
        .map(|_| ())
        .map_err(|_| AppError::new(INVALID_ARCHIVE))
}

pub(super) async fn snapshot_entries(
    files: &FileStore,
    snapshot: &Db,
) -> Result<Vec<SnapshotEntry>, AppError> {
    const LIMIT: std::num::NonZeroU32 = std::num::NonZeroU32::new(MAX_ENTRIES as u32).unwrap();
    let entries = files
        .snapshot_entries(snapshot, LIMIT, MAX_FILE)
        .await
        .map_err(|error| {
            AppError::new(match error.code() {
                crate::file::MISSING => FILE_MISSING,
                crate::file::TOO_LARGE => TOO_LARGE,
                crate::error::INPUT_INVALID => INVALID_ARCHIVE,
                _ => EXPORT_FAILED,
            })
        })?;
    if entries.len() + 3 > MAX_ENTRIES {
        return Err(AppError::new(TOO_LARGE));
    }
    Ok(entries)
}

/// 所有非终态工作（含停用模块的遗留任务）均会阻止用户归档。
pub async fn check_quiescent(db: &Db) -> Result<(), AppError> {
    let pending: Option<(String,)> = db
        .fetch_optional(
            &Query::select()
                .column("id")
                .from("fw_job")
                .and_where(Expr::col("status").is_not_in([
                    "succeeded",
                    "failed",
                    "cancelled",
                    "needs_review",
                ]))
                .to_owned(),
        )
        .await
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    if pending.is_some() {
        return Err(AppError::new(NOT_QUIESCENT));
    }
    Ok(())
}

pub async fn export(
    input: BackupInput,
    cancellation: Arc<Cancellation>,
    progress: Progress,
) -> Result<(u64, String), AppError> {
    if input.db.dialect() != Dialect::Sqlite {
        return Err(AppError::new(UNSUPPORTED_DATABASE));
    }
    validate_projection(&input.config_projection)?;
    check_layout(&input.state_root, &input.scratch)?;
    check_quiescent(&input.db).await?;
    cancellation.check()?;
    let target = {
        let (destination, root, scratch, signal) = (
            input.destination.clone(),
            input.state_root.clone(),
            input.scratch.clone(),
            cancellation.clone(),
        );
        tokio::task::spawn_blocking(move || Target::capture(&destination, &root, &scratch, &signal))
            .await
            .map_err(|_| AppError::new(EXPORT_FAILED))??
    };
    let stage = tempfile::Builder::new()
        .prefix("backup-")
        .tempdir_in(&input.scratch)
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    let db_path = stage.path().join("snapshot.db");
    progress(Phase::Snapshotting, 0, None);
    super::sqlite::snapshot_sqlite(&input.db, &db_path, cancellation.clone()).await?;
    if fs::metadata(&db_path)
        .map_err(|_| AppError::new(EXPORT_FAILED))?
        .len()
        > MAX_DATABASE
    {
        return Err(AppError::new(TOO_LARGE));
    }
    let snapshot = Db::open_sqlite(&db_path)
        .await
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let checked = async {
        let integrity: Vec<(String,)> = snapshot
            .fetch_all(
                &Query::select()
                    .expr(Expr::cust("quick_check"))
                    .from("pragma_quick_check")
                    .to_owned(),
            )
            .await
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        if integrity != [("ok".into(),)] {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        let report = migrate::status(&snapshot, &input.migrations)
            .await
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        report
            .ensure_upgradeable()
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        if !report.pending.is_empty() {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        let records = report
            .applied
            .into_iter()
            .map(|m| MigrationEntry {
                module: m.module,
                version: m.version,
                name: m.name,
                checksum: m.checksum,
                status: m.status,
            })
            .collect();
        let entries = snapshot_entries(&input.files, &snapshot).await?;
        Ok((records, entries))
    }
    .await;
    snapshot.close().await;
    let (records, files) = checked?;
    cancellation.check()?;
    tokio::task::spawn_blocking(move || {
        let manifest = BackupManifest {
            format: "tenon-backup".into(),
            format_version: 1,
            product_id: input.product_id,
            app_version: input.app_version,
            created_at: jiff::Timestamp::now().to_string(),
            source_instance_id: input.files.instance_id().to_string(),
            database_kind: "sqlite".into(),
            migration_records: records,
            entries: Vec::new(),
            total_bytes: 0,
            excluded: EXCLUDED.iter().map(|s| (*s).to_owned()).collect(),
        };
        write_archive(
            stage.path(),
            &input.config_projection,
            files,
            manifest,
            target,
            &cancellation,
            &progress,
        )
    })
    .await
    .map_err(|_| AppError::new(EXPORT_FAILED))?
}

pub(super) fn copy_hash(
    input: &mut impl Read,
    output: &mut impl Write,
    limit: u64,
    cancel: &Cancellation,
    mut progress: impl FnMut(u64),
) -> Result<(u64, String), AppError> {
    let mut count = 0_u64;
    let mut hash = Sha256::new();
    let mut buf = [0_u8; 64 * 1024];
    loop {
        cancel.check()?;
        let n = input
            .read(&mut buf)
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        if n == 0 {
            break;
        }
        count = count
            .checked_add(n as u64)
            .ok_or_else(|| AppError::new(TOO_LARGE))?;
        if count > limit {
            return Err(AppError::new(TOO_LARGE));
        }
        output
            .write_all(&buf[..n])
            .map_err(|_| AppError::new(EXPORT_FAILED))?;
        hash.update(&buf[..n]);
        progress(count);
    }
    Ok((count, format!("{:x}", hash.finalize())))
}

struct Source<'a> {
    path: String,
    reader: Box<dyn Read + 'a>,
    expected: Option<(u64, String)>,
}

fn write_archive(
    stage: &Path,
    config: &[u8],
    files: Vec<SnapshotEntry>,
    mut manifest: BackupManifest,
    target: Target,
    cancel: &Cancellation,
    progress: &Progress,
) -> Result<(u64, String), AppError> {
    let db = stage.join("snapshot.db");
    let mut staged = Vec::new();
    let mut sources = vec![
        Source {
            path: "database/app.db".into(),
            reader: Box::new(File::open(db).map_err(|_| AppError::new(EXPORT_FAILED))?),
            expected: None,
        },
        Source {
            path: "config.json".into(),
            reader: Box::new(std::io::Cursor::new(config)),
            expected: None,
        },
    ];
    for entry in files {
        sources.push(Source {
            path: entry.path,
            reader: Box::new(entry.file),
            expected: Some((entry.bytes, entry.sha256)),
        });
    }
    if sources.len() + 1 > MAX_ENTRIES {
        return Err(AppError::new(TOO_LARGE));
    }
    for Source {
        path,
        mut reader,
        expected,
    } in sources
    {
        let mut file =
            tempfile::NamedTempFile::new_in(stage).map_err(|_| AppError::new(EXPORT_FAILED))?;
        let (bytes, sha256) = copy_hash(
            &mut reader,
            &mut file,
            std::cmp::min(entry_limit(&path)?, MAX_TOTAL - manifest.total_bytes),
            cancel,
            |done| progress(Phase::Copying, manifest.total_bytes + done, None),
        )?;
        if expected.is_some_and(|expected| expected != (bytes, sha256.clone())) {
            return Err(AppError::new(HASH_MISMATCH));
        }
        manifest.total_bytes += bytes;
        manifest.entries.push(ManifestEntry {
            path,
            bytes,
            sha256,
        });
        file.rewind().map_err(|_| AppError::new(EXPORT_FAILED))?;
        staged.push(file);
    }
    manifest.validate(&manifest.product_id)?;
    let json = serde_json::to_vec(&manifest).map_err(|_| AppError::new(EXPORT_FAILED))?;
    if json.len() as u64 > MAX_MANIFEST || manifest.total_bytes + json.len() as u64 > MAX_TOTAL {
        return Err(AppError::new(TOO_LARGE));
    }
    let mut archive =
        tempfile::NamedTempFile::new_in(stage).map_err(|_| AppError::new(EXPORT_FAILED))?;
    let mut zip = ZipWriter::new(archive.as_file_mut());
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o600);
    zip.start_file("manifest.json", options)
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    cancel.check()?;
    zip.write_all(&json)
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    let mut written = 0;
    for (entry, file) in manifest.entries.iter().zip(&mut staged) {
        cancel.check()?;
        zip.start_file(&entry.path, options)
            .map_err(|_| AppError::new(EXPORT_FAILED))?;
        let (bytes, hash) = copy_hash(file, &mut zip, entry.bytes, cancel, |done| {
            progress(Phase::Archiving, written + done, Some(manifest.total_bytes))
        })?;
        if bytes != entry.bytes || hash != entry.sha256 {
            return Err(AppError::new(HASH_MISMATCH));
        }
        written += bytes;
    }
    zip.finish().map_err(|_| AppError::new(EXPORT_FAILED))?;
    archive
        .as_file()
        .sync_all()
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    progress(Phase::Verifying, 0, Some(manifest.total_bytes));
    validate_archive(archive.path(), &manifest.product_id, cancel)?;
    archive.rewind().map_err(|_| AppError::new(EXPORT_FAILED))?;
    let artifact = copy_hash(
        &mut archive,
        &mut std::io::sink(),
        MAX_TOTAL + 4 * MAX_MANIFEST,
        cancel,
        |_| {},
    )?;
    target.commit(archive, cancel)?;
    Ok(artifact)
}

/// 仅 Stored 和固定路径集合；实际解读字节也计数，不信任中央目录声明。
pub fn validate_archive(
    path: &Path,
    product: &str,
    cancel: &Cancellation,
) -> Result<BackupManifest, AppError> {
    read_archive(path, product, cancel, None)
}

pub(super) fn read_archive(
    path: &Path,
    product: &str,
    cancel: &Cancellation,
    destination: Option<&Path>,
) -> Result<BackupManifest, AppError> {
    let mut file = File::open(path).map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let length = file
        .metadata()
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?
        .len();
    if length > MAX_TOTAL + 4 * MAX_MANIFEST {
        return Err(AppError::new(TOO_LARGE));
    }
    // 2GiB / 10000 条目的本格式不使用 ZIP64、多卷或 ZIP 注释。
    // zip 8.6.0 读取时按名称去重，必须在解析前保留 EOCD 原始条目数作交叉检查。
    file.seek(SeekFrom::End(-22))
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let mut footer = [0; 22];
    file.read_exact(&mut footer)
        .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let u16_at = |n| u16::from_le_bytes([footer[n], footer[n + 1]]);
    let u32_at = |n| u32::from_le_bytes([footer[n], footer[n + 1], footer[n + 2], footer[n + 3]]);
    let count = u16_at(10) as usize;
    if count > MAX_ENTRIES || u32_at(12) as u64 > MAX_MANIFEST {
        return Err(AppError::new(TOO_LARGE));
    }
    if footer[..4] != *b"PK\x05\x06"
        || u16_at(4) != 0
        || u16_at(6) != 0
        || u16_at(8) as usize != count
        || u16_at(20) != 0
        || u32_at(12) as u64 + u32_at(16) as u64 + 22 != length
    {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    file.rewind().map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    let mut archive = ZipArchive::new(file).map_err(|_| AppError::new(INVALID_ARCHIVE))?;
    if archive.len() != count
        || archive.offset() != 0
        || archive
            .has_overlapping_files()
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?
    {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    let manifest: BackupManifest = {
        let mut file = archive
            .by_name("manifest.json")
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        let mut bytes = Vec::new();
        copy_hash(&mut file, &mut bytes, MAX_MANIFEST, cancel, |_| {})?;
        let manifest: BackupManifest =
            serde_json::from_slice(&bytes).map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        if manifest.total_bytes > MAX_TOTAL.saturating_sub(bytes.len() as u64) {
            return Err(AppError::new(TOO_LARGE));
        }
        manifest
    };
    manifest.validate(product)?;
    if archive.len() != manifest.entries.len() + 1 {
        return Err(AppError::new(INVALID_ARCHIVE));
    }
    let mut names = BTreeSet::new();
    for i in 0..archive.len() {
        cancel.check()?;
        let mut file = archive
            .by_index(i)
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?;
        let name = file
            .name()
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?
            .into_owned();
        let limit = entry_limit(&name)?;
        if !names.insert(name.clone())
            || !file.is_file()
            || file.encrypted()
            || file.compression() != CompressionMethod::Stored
            || file
                .unix_mode()
                .is_some_and(|m| m & 0o170000 != 0 && m & 0o170000 != 0o100000)
        {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        if file.size() > limit {
            return Err(AppError::new(TOO_LARGE));
        }
        let declared = file.size();
        let (bytes, hash) = if let Some(root) = destination {
            let path = root.join(&name);
            fs::create_dir_all(
                path.parent()
                    .ok_or_else(|| AppError::new(INVALID_ARCHIVE))?,
            )
            .map_err(|_| AppError::new(RESTORE_FAILED))?;
            regular_path(&path, true)?;
            let mut output = File::create_new(path).map_err(|_| AppError::new(RESTORE_FAILED))?;
            let result = copy_hash(&mut file, &mut output, limit, cancel, |_| {})?;
            output
                .sync_all()
                .map_err(|_| AppError::new(RESTORE_FAILED))?;
            result
        } else {
            copy_hash(&mut file, &mut std::io::sink(), limit, cancel, |_| {})?
        };
        if bytes != declared {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        if name != "manifest.json" {
            let entry = manifest
                .entries
                .iter()
                .find(|e| e.path == name)
                .ok_or_else(|| AppError::new(INVALID_ARCHIVE))?;
            if bytes != entry.bytes || hash != entry.sha256 {
                return Err(AppError::new(HASH_MISMATCH));
            }
        }
    }
    let mut projection = Vec::new();
    copy_hash(
        &mut archive
            .by_name("config.json")
            .map_err(|_| AppError::new(INVALID_ARCHIVE))?,
        &mut projection,
        MAX_MANIFEST,
        cancel,
        |_| {},
    )?;
    validate_projection(&projection)?;
    Ok(manifest)
}
