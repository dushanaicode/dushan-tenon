use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use sea_query::{Expr, ExprTrait, Order, Query, SelectStatement};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use super::{
    sniff::{Extension, HEAD_BYTES, sniff, text_prefix},
    *,
};
use crate::{
    actor::{Actor, ExecutionContext},
    db::{Db, Page, Table, contains_literal, select},
    error::{
        AppError, DATA_NOT_FOUND, DATA_VERSION_CONFLICT, INPUT_INVALID, INTERNAL_UNEXPECTED,
        JOB_CANCELLED,
    },
    instance::InstanceId,
};

const MIB: u64 = 1024 * 1024;
const TABLE: Table = Table {
    name: "fw_file",
    audit: true,
    soft_delete: false,
    optimistic_lock: true,
};

#[derive(Clone)]
pub struct FileStore(Arc<Inner>);

/// 仅向归档层提供校验过的登记内容句柄，不暴露磁盘路径。
pub(crate) struct SnapshotEntry {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    pub file: File,
}

struct Inner {
    db: Db,
    root: PathBuf,
    instance_id: InstanceId,
    max_mib: u64,
    declarations: BTreeMap<&'static str, FilePurposeDeclaration>,
}

impl FileStore {
    /// 仅用于尚未投入使用的恢复副本；混合或空实例登记不能合并。
    pub(crate) async fn rebind_restored_instance(
        stage: &Db,
        source: &str,
        target: InstanceId,
    ) -> Result<(), AppError> {
        let mut tx = stage.begin().await?;
        let foreign: Option<(String,)> = tx
            .fetch_optional(
                &Query::select()
                    .column("id")
                    .from("fw_file")
                    .and_where(
                        Expr::col("instance_id")
                            .ne(source)
                            .or(Expr::col("instance_id").is_null()),
                    )
                    .to_owned(),
            )
            .await?;
        if foreign.is_some() {
            tx.rollback().await?;
            return Err(invalid("instance_id"));
        }
        tx.execute(
            &Query::update()
                .table("fw_file")
                .value("instance_id", target.to_string())
                .and_where(Expr::col("instance_id").eq(source))
                .to_owned(),
        )
        .await?;
        tx.commit().await
    }

    pub(crate) async fn snapshot_entries(
        &self,
        snapshot: &Db,
        limit: std::num::NonZeroU32,
        max_file: u64,
    ) -> Result<Vec<SnapshotEntry>, AppError> {
        let mut tx = snapshot.begin().await?;
        let records: Vec<FileRecord> = tx.fetch_batch(&self.query(), limit).await?;
        tx.rollback().await?;
        records
            .into_iter()
            .map(|record| {
                let path = self.path(&record).map_err(|_| AppError::new(MISSING))?;
                // 同时检查根之上的现存分量，不能经根目录的父联接读取附件。
                for ancestor in path.ancestors().filter(|path| path.has_root()) {
                    let metadata =
                        fs::symlink_metadata(ancestor).map_err(|_| AppError::new(MISSING))?;
                    if is_link(&metadata) {
                        return Err(AppError::new(MISSING));
                    }
                }
                let file = File::open(path).map_err(|_| AppError::new(MISSING))?;
                let metadata = file.metadata().map_err(|_| AppError::new(MISSING))?;
                let bytes = u64::try_from(record.size_bytes).map_err(|_| invalid("size_bytes"))?;
                if !metadata.is_file() || metadata.len() != bytes {
                    return Err(AppError::new(MISSING));
                }
                if bytes > max_file {
                    return Err(AppError::new(TOO_LARGE));
                }
                Ok(SnapshotEntry {
                    path: format!("files/{}", record.stored_path),
                    bytes,
                    sha256: record.sha256,
                    file,
                })
            })
            .collect()
    }

    pub fn instance_id(&self) -> InstanceId {
        self.0.instance_id
    }

    pub fn new(
        db: Db,
        state_root: &Path,
        instance_id: InstanceId,
        max_mib: u64,
        declarations: &[FilePurposeDeclaration],
    ) -> Self {
        Self(Arc::new(Inner {
            db,
            root: state_root.join("files"),
            instance_id,
            max_mib,
            declarations: declarations.iter().map(|d| (d.code, *d)).collect(),
        }))
    }

    pub fn purposes(&self) -> Vec<FilePurposeDeclaration> {
        self.0.declarations.values().copied().collect()
    }

    fn query(&self) -> SelectStatement {
        select(TABLE)
            .into_query()
            .clear_selects()
            .columns([
                "id",
                "purpose",
                "original_name",
                "extension",
                "size_bytes",
                "sha256",
                "stored_path",
                "created_at",
                "created_by",
                "row_version",
            ])
            .and_where(Expr::col("instance_id").eq(self.0.instance_id.to_string()))
            .to_owned()
    }

    pub async fn add(
        &self,
        actor: &ExecutionContext,
        purpose: &str,
        source: &Path,
    ) -> Result<FileRecord, AppError> {
        let declaration = self
            .0
            .declarations
            .get(purpose)
            .ok_or_else(|| invalid("purpose"))?;
        let (original_name, extension) = source_name(source)?;
        if !declaration.extensions.contains(&extension.as_str()) {
            return Err(AppError::new(TYPE_NOT_ALLOWED));
        }
        let known_extension =
            Extension::parse(&extension).ok_or_else(|| AppError::new(TYPE_NOT_ALLOWED))?;
        let Actor::User(created_by) = actor.actor else {
            return Err(internal(io::Error::other(
                "file creation requires a user actor",
            )));
        };
        let max_mib = self.0.max_mib;
        let created_at = Timestamp::now();
        let id = Id::new();
        let mut record = FileRecord {
            id,
            purpose: purpose.into(),
            original_name,
            extension,
            size_bytes: 0,
            sha256: String::new(),
            stored_path: relative(id, created_at)?,
            created_at,
            created_by,
            row_version: 1,
            missing: false,
        };
        let source = source.to_owned();
        let store = self.clone();
        record = disk(move || {
            let mut source = File::open(source).map_err(internal)?;
            let metadata = source.metadata().map_err(internal)?;
            if !metadata.is_file() {
                return Err(invalid("file"));
            }
            if metadata.len() > max_mib * MIB {
                return Err(too_large(max_mib));
            }
            let partial = safe_path(&store.0.root, &format!("tmp/{id}.part"))?;
            let partial_dir = safe_path(&store.0.root, "tmp")?;
            fs::create_dir_all(partial_dir).map_err(internal)?;
            let output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&partial)
                .map_err(internal)?;
            let guard = PartialFile(partial);
            let (size, hash, head) =
                copy_limited(&mut source, output, max_mib, &CancellationToken::new())?;
            if !sniff(known_extension, &head) {
                return Err(AppError::new(CONTENT_MISMATCH));
            }
            let final_path = store.path(&record)?;
            let final_dir = safe_path(&store.0.root, &directory(record.created_at)?)?;
            fs::create_dir_all(final_dir).map_err(internal)?;
            fs::rename(&guard.0, final_path).map_err(internal)?;
            record.size_bytes = size as i64;
            record.sha256 = hash;
            Ok(record)
        })
        .await?;
        let inserted = async {
            let mut tx = self.0.db.begin().await?;
            // ID 与创建时间在落盘前确定；framework 在这里写入自己的审计列。
            let mut query = Query::insert();
            query
                .into_table(TABLE.name)
                .columns([
                    "id",
                    "instance_id",
                    "purpose",
                    "original_name",
                    "extension",
                    "size_bytes",
                    "sha256",
                    "stored_path",
                    "created_at",
                    "created_by",
                    "updated_at",
                    "updated_by",
                    "row_version",
                ])
                .values_panic([
                    id.into(),
                    self.0.instance_id.to_string().into(),
                    record.purpose.clone().into(),
                    record.original_name.clone().into(),
                    record.extension.clone().into(),
                    record.size_bytes.into(),
                    record.sha256.clone().into(),
                    record.stored_path.clone().into(),
                    created_at.into(),
                    created_by.into(),
                    created_at.into(),
                    created_by.into(),
                    1_i64.into(),
                ]);
            tx.execute(&query).await?;
            tx.commit().await
        }
        .await;
        if let Err(error) = inserted {
            let store = self.clone();
            let cleanup = record.clone();
            disk(move || remove_if_exists(&store.path(&cleanup)?).map_err(internal)).await?;
            return Err(error);
        }
        Ok(record)
    }

    pub async fn list(&self, input: FileListInput) -> Result<Page<FileRecord>, AppError> {
        let mut query = self.query();
        if let Some(purpose) = input.purpose {
            query.and_where(Expr::col("purpose").eq(purpose));
        }
        if let Some(keyword) = input.keyword {
            query.and_where(Expr::col("original_name").like(contains_literal(&keyword)));
        }
        let mut page = self
            .0
            .db
            .fetch_page::<FileRecord>(
                &query,
                input.pagination,
                &[("created_at", Order::Desc), ("id", Order::Desc)],
            )
            .await?;
        let store = self.clone();
        disk(move || {
            for record in &mut page.items {
                record.missing = missing(&store.path(record)?)?;
            }
            Ok(page)
        })
        .await
    }

    pub async fn get(&self, id: Id) -> Result<FileRecord, AppError> {
        self.0
            .db
            .fetch_optional(&self.query().and_where(Expr::col("id").eq(id)).to_owned())
            .await?
            .ok_or_else(|| AppError::new(DATA_NOT_FOUND))
    }

    fn path(&self, record: &FileRecord) -> Result<PathBuf, AppError> {
        let relative = relative(record.id, record.created_at)?;
        if record.stored_path != relative {
            return Err(internal(io::Error::other("invalid stored file path")));
        }
        safe_path(&self.0.root, &relative)
    }

    pub async fn preview(&self, id: Id) -> Result<FilePreview, AppError> {
        let record = self.get(id).await?;
        let store = self.clone();
        disk(move || {
            let file = File::open(store.path(&record)?).map_err(read_error)?;
            let mime = match record.extension.as_str() {
                "png" => Some("image/png"),
                "jpg" | "jpeg" => Some("image/jpeg"),
                "gif" => Some("image/gif"),
                "webp" => Some("image/webp"),
                _ => None,
            };
            if let Some(mime) = mime {
                if file.metadata().map_err(internal)?.len() > 5 * MIB {
                    return Err(AppError::new(PREVIEW_TOO_LARGE));
                }
                let mut bytes = Vec::new();
                file.take(5 * MIB + 1)
                    .read_to_end(&mut bytes)
                    .map_err(internal)?;
                if bytes.len() as u64 > 5 * MIB {
                    return Err(AppError::new(PREVIEW_TOO_LARGE));
                }
                Ok(FilePreview::Image {
                    mime: mime.into(),
                    data_url: format!("data:{mime};base64,{}", base64(&bytes)),
                })
            } else if ["txt", "md", "csv", "json"].contains(&record.extension.as_str()) {
                let mut bytes = Vec::new();
                file.take(HEAD_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(internal)?;
                let more = bytes.len() > HEAD_BYTES;
                bytes.truncate(HEAD_BYTES);
                let text = text_prefix(&bytes).ok_or_else(|| AppError::new(CONTENT_MISMATCH))?;
                let truncated = more || text.len() < bytes.len();
                Ok(FilePreview::Text {
                    text: text.to_owned(),
                    truncated,
                })
            } else {
                Err(AppError::new(PREVIEW_UNSUPPORTED))
            }
        })
        .await
    }

    /// Read one bounded UTF-8 block, carrying the same file observation across pages.
    pub async fn text_page(&self, input: FileTextPageInput) -> Result<FileTextPage, AppError> {
        if (input.offset > 0 && input.fingerprint.is_none())
            || input.fingerprint.as_ref().is_some_and(|value| {
                value.len() != 64
                    || !value
                        .bytes()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            })
        {
            return Err(invalid("fingerprint"));
        }
        let record = self.get(input.id).await?;
        if !["txt", "md", "csv", "json"].contains(&record.extension.as_str()) {
            return Err(AppError::new(PREVIEW_UNSUPPORTED));
        }
        let store = self.clone();
        disk(move || {
            let mut file = File::open(store.path(&record)?).map_err(read_error)?;
            let metadata = file.metadata().map_err(internal)?;
            if metadata.len() != record.size_bytes as u64 {
                return Err(AppError::new(DATA_VERSION_CONFLICT));
            }
            let fingerprint = text_fingerprint(&record, &metadata)?;
            if input
                .fingerprint
                .as_ref()
                .is_some_and(|expected| expected != &fingerprint)
            {
                return Err(AppError::new(DATA_VERSION_CONFLICT));
            }
            if input.offset > metadata.len() {
                return Err(invalid("offset"));
            }
            file.seek(SeekFrom::Start(input.offset)).map_err(internal)?;
            let mut bytes = Vec::new();
            (&mut file)
                .take(HEAD_BYTES as u64)
                .read_to_end(&mut bytes)
                .map_err(internal)?;
            if text_fingerprint(&record, &file.metadata().map_err(internal)?)? != fingerprint {
                return Err(AppError::new(DATA_VERSION_CONFLICT));
            }
            let text = text_prefix(&bytes).ok_or_else(|| AppError::new(CONTENT_MISMATCH))?;
            let end = text.len();
            if end < bytes.len() && input.offset + bytes.len() as u64 == metadata.len() {
                return Err(AppError::new(CONTENT_MISMATCH));
            }
            if end == 0 && input.offset < metadata.len() {
                return Err(AppError::new(CONTENT_MISMATCH));
            }
            let next = input.offset + end as u64;
            Ok(FileTextPage {
                text: text.to_owned(),
                offset: input.offset,
                next_offset: (next < metadata.len()).then_some(next),
                total_bytes: metadata.len(),
                fingerprint,
            })
        })
        .await
    }

    pub async fn save_copy(&self, id: Id, dest: &Path) -> Result<(), AppError> {
        let record = self.get(id).await?;
        if dest
            .extension()
            .and_then(|v| v.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
            != Some(&record.extension)
        {
            return Err(AppError::new(TYPE_NOT_ALLOWED));
        }
        let dest = dest.to_owned();
        let store = self.clone();
        let cancellation = CancellationToken::new();
        let _cancel_on_drop = cancellation.clone().drop_guard();
        disk(move || {
            let mut source = File::open(store.path(&record)?).map_err(read_error)?;
            save_file(&mut source, &dest, id, &cancellation)
        })
        .await
    }

    pub async fn delete(&self, id: Id, row_version: i64) -> Result<(), AppError> {
        let mut tx = self.0.db.begin().await?;
        let record: FileRecord = tx
            .fetch_optional(
                &self
                    .query()
                    .and_where(Expr::col("id").eq(id))
                    .lock_exclusive()
                    .to_owned(),
            )
            .await?
            .ok_or_else(|| AppError::new(DATA_NOT_FOUND))?;
        if record.row_version != row_version {
            return Err(AppError::new(DATA_VERSION_CONFLICT));
        }
        tx.delete_by_id(TABLE, id).await?;
        tx.commit().await?;
        let store = self.clone();
        if let Err(error) =
            disk(move || remove_if_exists(&store.path(&record)?).map_err(internal)).await
        {
            tracing::warn!(file_id = %id, code = %error.code(), "文件记录已删除，磁盘文件等待回收");
        }
        Ok(())
    }

    pub async fn reclaim(&self) -> Result<ReclaimReport, AppError> {
        let records: Vec<FileRecord> = self.0.db.fetch_all(&self.query()).await?;
        let store = self.clone();
        disk(move || {
            let root = safe_path(&store.0.root, "")?;
            let ids: BTreeSet<_> = records.iter().map(|r| r.id.to_string()).collect();
            let mut report = ReclaimReport::default();
            for record in &records {
                report.missing_rows += u32::from(missing(&store.path(record)?)?);
            }
            if missing(&root)? {
                return Ok(report);
            }
            let cutoff = SystemTime::now() - Duration::from_secs(3600);
            for year in entries(&root, &mut report) {
                if !numeric_dir(&year, 4) {
                    continue;
                }
                for month in entries(&year.path(), &mut report) {
                    if !numeric_dir(&month, 2) {
                        continue;
                    }
                    for entry in entries(&month.path(), &mut report) {
                        if !ids.contains(&entry.file_name().to_string_lossy().into_owned()) {
                            reclaim_file(&root, &entry.path(), cutoff, false, &mut report);
                        }
                    }
                }
            }
            let tmp = root.join("tmp");
            match fs::symlink_metadata(&tmp) {
                Ok(meta) if meta.is_dir() && !is_link(&meta) => {
                    for entry in entries(&tmp, &mut report) {
                        reclaim_file(&root, &entry.path(), cutoff, true, &mut report);
                    }
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => report.failed += 1,
            }
            Ok(report)
        })
        .await
    }
}

fn directory(at: Timestamp) -> Result<String, AppError> {
    let date = jiff::Timestamp::from_millisecond(at.as_millis())
        .map_err(internal)?
        .to_zoned(jiff::tz::TimeZone::UTC);
    Ok(format!("{:04}/{:02}", date.year(), date.month()))
}

fn relative(id: Id, at: Timestamp) -> Result<String, AppError> {
    Ok(format!("{}/{id}", directory(at)?))
}

fn source_name(source: &Path) -> Result<(String, String), AppError> {
    let name = source
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| invalid("file"))?;
    if name.chars().count() > 255 || name.chars().any(char::is_control) {
        return Err(invalid("file"));
    }
    let extension = source
        .extension()
        .and_then(|v| v.to_str())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| invalid("file"))?;
    Ok((name.into(), extension.to_ascii_lowercase()))
}

fn safe_path(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let root = std::path::absolute(root).map_err(internal)?;
    let path = root.join(relative);
    if !path.starts_with(&root)
        || Path::new(relative)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(internal(io::Error::other("file path escapes storage")));
    }
    let mut current = root;
    for component in std::iter::once(None).chain(Path::new(relative).components().map(Some)) {
        if let Some(component) = component {
            current.push(component);
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link(&metadata) => {
                return Err(internal(io::Error::other(
                    "links are not allowed in file storage",
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(internal(error)),
        }
    }
    Ok(path)
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // 目录联接同符号链接处理；不跟随任何 reparse point。
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn missing(path: &Path) -> Result<bool, AppError> {
    match fs::metadata(path) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(internal(error)),
    }
}

fn entries(path: &Path, report: &mut ReclaimReport) -> Vec<fs::DirEntry> {
    match fs::read_dir(path) {
        Ok(entries) => entries
            .filter_map(|entry| match entry {
                Ok(entry) => Some(entry),
                Err(_) => {
                    report.failed += 1;
                    None
                }
            })
            .collect(),
        Err(_) => {
            report.failed += 1;
            Vec::new()
        }
    }
}

fn numeric_dir(entry: &fs::DirEntry, length: usize) -> bool {
    entry
        .file_name()
        .to_str()
        .is_some_and(|name| name.len() == length && name.bytes().all(|b| b.is_ascii_digit()))
        && fs::symlink_metadata(entry.path()).is_ok_and(|meta| meta.is_dir() && !is_link(&meta))
}

fn text_fingerprint(record: &FileRecord, metadata: &Metadata) -> Result<String, AppError> {
    let modified = metadata
        .modified()
        .map_err(internal)?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(internal)?;
    let mut hash = Sha256::new();
    hash.update(record.sha256.as_bytes());
    hash.update(record.row_version.to_le_bytes());
    hash.update(metadata.len().to_le_bytes());
    hash.update(modified.as_nanos().to_le_bytes());
    Ok(format!("{:x}", hash.finalize()))
}

fn reclaim_file(
    root: &Path,
    path: &Path,
    cutoff: SystemTime,
    tmp: bool,
    report: &mut ReclaimReport,
) {
    let result = (|| {
        let meta = fs::symlink_metadata(path)?;
        if is_link(&meta) || !meta.is_file() || meta.modified()? >= cutoff {
            return Ok(());
        }
        let resolved = path.canonicalize()?;
        if !resolved.starts_with(root.canonicalize()?) {
            return Err(io::Error::other("file path escapes storage"));
        }
        fs::remove_file(path)?;
        if tmp {
            report.stale_tmp += 1;
        } else {
            report.orphan_files += 1;
            report.orphan_bytes += meta.len();
        }
        Ok::<_, io::Error>(())
    })();
    if result.is_err() {
        report.failed += 1;
    }
}

fn copy_limited(
    source: &mut impl Read,
    mut output: File,
    max_mib: u64,
    cancellation: &CancellationToken,
) -> Result<(u64, String, Vec<u8>), AppError> {
    let mut buffer = [0; HEAD_BYTES];
    let mut head = Vec::new();
    let mut size = 0;
    let mut hash = Sha256::new();
    loop {
        cancelled(cancellation)?;
        let count = source.read(&mut buffer).map_err(internal)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > max_mib * MIB {
            return Err(too_large(max_mib));
        }
        head.extend_from_slice(&buffer[..count.min(HEAD_BYTES - head.len())]);
        hash.update(&buffer[..count]);
        output.write_all(&buffer[..count]).map_err(internal)?;
    }
    output.sync_all().map_err(internal)?;
    Ok((size, format!("{:x}", hash.finalize()), head))
}

fn save_file(
    source: &mut impl Read,
    dest: &Path,
    id: Id,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    let name = dest.file_name().ok_or_else(|| invalid("file"))?;
    let mut partial_name = name.to_os_string();
    partial_name.push(format!(".{id}.partial"));
    let partial = dest.with_file_name(partial_name);
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)
        .map_err(internal)?;
    let guard = PartialFile(partial);
    // 写句柄在 guard 前释放，Windows 上失败与取消也能删除临时副本。
    let mut output = output;
    let mut buffer = [0; HEAD_BYTES];
    loop {
        cancelled(cancellation)?;
        let count = source.read(&mut buffer).map_err(internal)?;
        if count == 0 {
            break;
        }
        output.write_all(&buffer[..count]).map_err(internal)?;
    }
    output.sync_all().map_err(internal)?;
    drop(output);
    cancelled(cancellation)?;
    fs::rename(&guard.0, dest).map_err(internal)
}

// RFC 4648 标准字母表；本片不增加依赖。
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let bits = chunk
            .iter()
            .fold(0_u32, |bits, byte| (bits << 8) | u32::from(*byte))
            << ((3 - chunk.len()) * 8);
        for index in 0..4 {
            result.push(if index <= chunk.len() {
                ALPHABET[((bits >> (18 - index * 6)) & 63) as usize] as char
            } else {
                '='
            });
        }
    }
    result
}

struct PartialFile(PathBuf);
impl Drop for PartialFile {
    fn drop(&mut self) {
        if remove_if_exists(&self.0).is_err() {
            tracing::warn!("文件临时副本清理失败，等待回收");
        }
    }
}
fn remove_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}
fn cancelled(token: &CancellationToken) -> Result<(), AppError> {
    if token.is_cancelled() {
        Err(AppError::new(JOB_CANCELLED))
    } else {
        Ok(())
    }
}
fn invalid(path: &str) -> AppError {
    AppError::new(INPUT_INVALID).with_param("path", path)
}
fn too_large(max: u64) -> AppError {
    AppError::new(TOO_LARGE).with_param("max", max.to_string())
}
fn internal(error: impl std::error::Error + Send + Sync + 'static) -> AppError {
    AppError::new(INTERNAL_UNEXPECTED).with_source(error)
}
fn read_error(error: io::Error) -> AppError {
    if error.kind() == io::ErrorKind::NotFound {
        AppError::new(MISSING)
    } else {
        internal(error)
    }
}
async fn disk<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(internal)?
}

#[cfg(test)]
mod tests;
