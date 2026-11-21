//! 文件接入的预算、队列、身份隔离历史与一次性 claim；URI 和系统事件由宿主解析。
//! 宿主须在活动身份许可内调用 list/claim/dismiss/reopen，owner 不得来自 IPC。
use crate::{
    picked_files::{FilePicked, FilePurpose, PickedFileStore},
    state_root::create_directory,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tenon_framework::{
    actor::Actor,
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    file::KNOWN_EXTENSIONS,
    id::Id,
};
use ts_rs::TS;

pub const INVALID: ErrorCode = ErrorCode::new("app.file_ingress.invalid");
pub const LIMIT: ErrorCode = ErrorCode::new("app.file_ingress.limit");
pub const UNAVAILABLE: ErrorCode = ErrorCode::new("app.file_ingress.unavailable");
pub const RECENT_INVALID: ErrorCode = ErrorCode::new("app.file_ingress.recent_invalid");
pub const IO_FAILED: ErrorCode = ErrorCode::new("app.file_ingress.io_failed");
const MAX_PENDING: usize = 16;
const MAX_DIRECTORY_ENTRIES: usize = 64;
const MAX_RECENT: usize = 20;
const MAX_RECENT_BYTES: u64 = 128 * 1024;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FileIngressItem {
    File {
        id: String,
        name: String,
        extension: String,
    },
    Route {
        id: String,
        path: String,
    },
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileIngressSnapshot {
    pub pending: Vec<FileIngressItem>,
    pub recent: Vec<FileIngressItem>,
    pub issue: Option<String>,
    pub skipped_directories: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum FileIngressPurpose {
    Import,
    Store,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FileIngressClaim {
    pub id: String,
    pub purpose: FileIngressPurpose,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileIngressDismiss {
    pub ids: Vec<String>,
    pub clear_recent: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FileIngressId {
    pub id: String,
}

#[derive(Clone)]
enum Request {
    File(PathBuf),
    Route(String),
}
struct Entry {
    id: String,
    owner: Option<Id>,
    source_root: Option<PathBuf>,
    request: Request,
}
#[derive(Default)]
struct Pending {
    entries: Vec<Entry>,
    issue: Option<String>,
    skipped: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Recent {
    id: String,
    path: PathBuf,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecentFile {
    schema: u8,
    entries: Vec<Recent>,
}

#[derive(Default)]
pub struct FileIngress {
    pending: Mutex<Pending>,
    recent_lock: Mutex<()>,
}

fn checked_path(path: &Path) -> Result<fs::Metadata, AppError> {
    if !path.is_absolute() || path.as_os_str().len() > 4096 {
        return Err(AppError::new(INVALID));
    }
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err(AppError::new(INVALID));
    }
    let mut part = PathBuf::new();
    for component in path.components() {
        part.push(component.as_os_str());
        if matches!(component, std::path::Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&part).map_err(|_| AppError::new(UNAVAILABLE))?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::new(INVALID));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(AppError::new(INVALID));
            }
        }
    }
    fs::metadata(path).map_err(|_| AppError::new(UNAVAILABLE))
}

fn file_view(id: &str, path: &Path) -> Result<FileIngressItem, AppError> {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::new(INVALID))?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::new(INVALID))?
        .to_ascii_lowercase();
    if !KNOWN_EXTENSIONS.contains(&extension.as_str()) || name.len() > 1024 {
        return Err(AppError::new(INVALID));
    }
    Ok(FileIngressItem::File {
        id: id.into(),
        name: name.into(),
        extension,
    })
}

fn checked_file(path: &Path) -> Result<PathBuf, AppError> {
    let metadata = checked_path(path)?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(AppError::new(INVALID));
    }
    file_view("", path)?;
    path.canonicalize().map_err(|_| AppError::new(UNAVAILABLE))
}

fn recent_path(root: &Path, owner: Id) -> PathBuf {
    root.join("recent-files").join(format!("{owner}.json"))
}
fn read_recent(root: &Path, owner: Id) -> Result<Vec<Recent>, AppError> {
    let file = match fs::File::open(recent_path(root, owner)) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(AppError::new(IO_FAILED)),
    };
    let mut bytes = Vec::new();
    file.take(MAX_RECENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::new(IO_FAILED))?;
    if bytes.len() as u64 > MAX_RECENT_BYTES {
        return Err(AppError::new(RECENT_INVALID));
    }
    let recent: RecentFile =
        serde_json::from_slice(&bytes).map_err(|_| AppError::new(RECENT_INVALID))?;
    if recent.schema != 1
        || recent.entries.len() > MAX_RECENT
        || recent.entries.iter().enumerate().any(|(index, entry)| {
            !entry.path.is_absolute()
                || entry.path.as_os_str().len() > 4096
                || !valid_id(&entry.id)
                || recent.entries[..index]
                    .iter()
                    .any(|other| other.id == entry.id || other.path == entry.path)
        })
    {
        return Err(AppError::new(RECENT_INVALID));
    }
    Ok(recent.entries)
}
fn write_recent(root: &Path, owner: Id, entries: Vec<Recent>) -> Result<(), AppError> {
    let path = recent_path(root, owner);
    let directory = root.join("recent-files");
    create_directory(&directory).map_err(|_| AppError::new(IO_FAILED))?;
    let bytes = serde_json::to_vec(&RecentFile { schema: 1, entries })
        .map_err(|_| AppError::new(RECENT_INVALID))?;
    if bytes.len() as u64 > MAX_RECENT_BYTES {
        return Err(AppError::new(RECENT_INVALID));
    }
    let scratch = root.join("Temp").join("file-ingress");
    create_directory(&scratch).map_err(|_| AppError::new(IO_FAILED))?;
    let mut file =
        tempfile::NamedTempFile::new_in(&scratch).map_err(|_| AppError::new(IO_FAILED))?;
    file.write_all(&bytes)
        .map_err(|_| AppError::new(IO_FAILED))?;
    file.as_file()
        .sync_all()
        .map_err(|_| AppError::new(IO_FAILED))?;
    file.persist(path).map_err(|_| AppError::new(IO_FAILED))?;
    Ok(())
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && uuid::Uuid::parse_str(id)
            .is_ok_and(|value| value.get_version_num() == 4 && value.to_string() == id)
}

impl FileIngress {
    pub fn report(&self, error: &AppError) -> Result<(), AppError> {
        self.pending
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .issue = Some(error.code().as_str().into());
        Ok(())
    }

    pub fn enqueue_paths(
        &self,
        paths: &[PathBuf],
        source_root: Option<PathBuf>,
    ) -> Result<(), AppError> {
        let result = self.collect(paths, source_root);
        if let Err(error) = &result {
            self.report(error)?;
        }
        result
    }
    fn collect(&self, paths: &[PathBuf], source_root: Option<PathBuf>) -> Result<(), AppError> {
        if paths.is_empty() || paths.len() > MAX_PENDING {
            return Err(AppError::new(LIMIT));
        }
        let mut accepted = Vec::new();
        let mut scanned = 0;
        let mut skipped = 0;
        for path in paths {
            let metadata = checked_path(path)?;
            if metadata.is_dir() {
                for entry in fs::read_dir(path).map_err(|_| AppError::new(UNAVAILABLE))? {
                    scanned += 1;
                    if scanned > MAX_DIRECTORY_ENTRIES {
                        return Err(AppError::new(LIMIT));
                    }
                    let entry = entry.map_err(|_| AppError::new(UNAVAILABLE))?;
                    let child = entry.path();
                    if checked_path(&child)?.is_dir() {
                        skipped += 1;
                        continue;
                    }
                    accepted.push(checked_file(&child)?);
                    if accepted.len() > MAX_PENDING {
                        return Err(AppError::new(LIMIT));
                    }
                }
            } else {
                accepted.push(checked_file(path)?);
            }
        }
        accepted.sort();
        accepted.dedup();
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if pending.entries.len() + accepted.len() > MAX_PENDING {
            return Err(AppError::new(LIMIT));
        }
        pending
            .entries
            .extend(accepted.into_iter().map(|path| Entry {
                id: uuid::Uuid::new_v4().to_string(),
                owner: None,
                source_root: source_root.clone(),
                request: Request::File(path),
            }));
        pending.skipped = skipped;
        pending.issue = None;
        Ok(())
    }

    /// 宿主完成 URI 的 scheme/authority/query 校验后，仅传入路由路径。
    pub fn enqueue_route(&self, path: &str, source_root: Option<PathBuf>) -> Result<(), AppError> {
        let result = (|| {
            if !path.starts_with('/')
                || path.len() > 1024
                || path.contains("//")
                || !path
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_'))
            {
                return Err(AppError::new(INVALID));
            }
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            if pending.entries.len() >= MAX_PENDING {
                return Err(AppError::new(LIMIT));
            }
            pending.entries.push(Entry {
                id: uuid::Uuid::new_v4().to_string(),
                owner: None,
                source_root,
                request: Request::Route(path.into()),
            });
            pending.issue = None;
            Ok(())
        })();
        if let Err(error) = &result {
            self.report(error)?;
        }
        result
    }

    pub fn list(&self, root: &Path, owner: Id) -> Result<FileIngressSnapshot, AppError> {
        let _recent = self
            .recent_lock
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let recent = read_recent(root, owner)?
            .into_iter()
            .map(|entry| file_view(&entry.id, &entry.path))
            .collect::<Result<Vec<_>, _>>()?;
        let mut queue = self
            .pending
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        queue.entries.retain(|entry| {
            entry
                .source_root
                .as_ref()
                .is_none_or(|source| source == &canonical_root)
        });
        for entry in &mut queue.entries {
            if entry.owner.is_none() {
                entry.owner = Some(owner);
            }
        }
        let pending = queue
            .entries
            .iter()
            .filter(|entry| entry.owner == Some(owner))
            .map(|entry| match &entry.request {
                Request::File(path) => file_view(&entry.id, path),
                Request::Route(path) => Ok(FileIngressItem::Route {
                    id: entry.id.clone(),
                    path: path.clone(),
                }),
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(FileIngressSnapshot {
            pending,
            recent,
            issue: queue.issue.clone(),
            skipped_directories: queue.skipped,
        })
    }

    pub fn claim(
        &self,
        root: &Path,
        owner: Id,
        picked: &PickedFileStore,
        input: FileIngressClaim,
    ) -> Result<FilePicked, AppError> {
        if !valid_id(&input.id) {
            return Err(AppError::new(INVALID));
        }
        let _recent = self
            .recent_lock
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let mut queue = self
            .pending
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        let entry = queue
            .entries
            .iter()
            .find(|entry| {
                entry.id == input.id
                    && entry.owner == Some(owner)
                    && entry
                        .source_root
                        .as_ref()
                        .is_none_or(|source| source == &canonical_root)
            })
            .ok_or_else(|| AppError::new(UNAVAILABLE))?;
        let Request::File(path) = &entry.request else {
            return Err(AppError::new(INVALID));
        };
        let path = checked_file(path)?;
        let purpose = match input.purpose {
            FileIngressPurpose::Import => FilePurpose::Import,
            FileIngressPurpose::Store => FilePurpose::Store,
        };
        purpose.format(&path, None)?;
        let mut history = read_recent(root, owner)?;
        history.retain(|entry| entry.path != path);
        history.insert(
            0,
            Recent {
                id: uuid::Uuid::new_v4().to_string(),
                path: path.clone(),
            },
        );
        history.truncate(MAX_RECENT);
        let file = picked.insert(
            Actor::User(owner),
            purpose,
            path,
            &KNOWN_EXTENSIONS
                .iter()
                .map(|value| (*value).into())
                .collect::<Vec<_>>(),
        )?;
        if let Err(error) = write_recent(root, owner, history) {
            picked.revoke(&file.token, Actor::User(owner))?;
            return Err(error);
        }
        queue.entries.retain(|entry| entry.id != input.id);
        Ok(file)
    }

    pub fn dismiss(
        &self,
        root: &Path,
        owner: Id,
        input: FileIngressDismiss,
    ) -> Result<(), AppError> {
        if input.ids.len() > MAX_PENDING + MAX_RECENT || input.ids.iter().any(|id| !valid_id(id)) {
            return Err(AppError::new(INVALID));
        }
        let _recent = self
            .recent_lock
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if input.clear_recent {
            write_recent(root, owner, Vec::new())?;
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        pending
            .entries
            .retain(|entry| entry.owner != Some(owner) || !input.ids.contains(&entry.id));
        pending.issue = None;
        pending.skipped = 0;
        Ok(())
    }

    pub fn reopen(&self, root: &Path, owner: Id, input: FileIngressId) -> Result<(), AppError> {
        if !valid_id(&input.id) {
            return Err(AppError::new(INVALID));
        }
        let _recent = self
            .recent_lock
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let recent = read_recent(root, owner)?;
        let entry = recent
            .iter()
            .find(|entry| entry.id == input.id)
            .ok_or_else(|| AppError::new(UNAVAILABLE))?;
        let path = checked_file(&entry.path)?;
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if pending.entries.len() >= MAX_PENDING {
            return Err(AppError::new(LIMIT));
        }
        pending.entries.push(Entry {
            id: uuid::Uuid::new_v4().to_string(),
            owner: Some(owner),
            source_root: Some(
                root.canonicalize()
                    .map_err(|_| AppError::new(UNAVAILABLE))?,
            ),
            request: Request::File(path),
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_entry_pending_and_file_size_budgets_are_atomic() {
        let root = root();
        let directory = root.path().join("batch");
        fs::create_dir(&directory).unwrap();
        for index in 0..MAX_DIRECTORY_ENTRIES {
            fs::create_dir(directory.join(index.to_string())).unwrap();
        }
        let ingress = FileIngress::default();
        let owner = Id::new();
        ingress
            .enqueue_paths(std::slice::from_ref(&directory), None)
            .unwrap();
        assert_eq!(
            ingress
                .list(root.path(), owner)
                .unwrap()
                .skipped_directories,
            64
        );
        fs::create_dir(directory.join("overflow")).unwrap();
        assert_eq!(
            ingress
                .enqueue_paths(&[directory], None)
                .unwrap_err()
                .code(),
            LIMIT
        );
        for index in 0..MAX_PENDING {
            ingress
                .enqueue_route(&format!("/route/{index}"), None)
                .unwrap();
        }
        assert_eq!(
            ingress.enqueue_route("/overflow", None).unwrap_err().code(),
            LIMIT
        );
        assert_eq!(
            ingress.list(root.path(), owner).unwrap().pending.len(),
            MAX_PENDING
        );
        let path = root.path().join("large.txt");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        let other = FileIngress::default();
        assert_eq!(
            other
                .enqueue_paths(std::slice::from_ref(&path), None)
                .unwrap_err()
                .code(),
            INVALID
        );
        assert!(other.list(root.path(), owner).unwrap().pending.is_empty());
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_FILE_BYTES)
            .unwrap();
        other.enqueue_paths(&[path], None).unwrap();
    }

    #[test]
    fn recent_is_bounded_deduplicated_persistent_and_owner_isolated() {
        let root = root();
        let ingress = FileIngress::default();
        let owner = Id::new();
        let picked = PickedFileStore::default();
        for index in 0..=MAX_RECENT {
            let path = root.path().join(format!("{index}.txt"));
            fs::write(&path, b"text").unwrap();
            ingress.enqueue_paths(&[path], None).unwrap();
            let pending = ingress.list(root.path(), owner).unwrap().pending;
            let file = ingress
                .claim(
                    root.path(),
                    owner,
                    &picked,
                    FileIngressClaim {
                        id: file_id(&pending[0]).into(),
                        purpose: FileIngressPurpose::Store,
                    },
                )
                .unwrap();
            picked.revoke(&file.token, Actor::User(owner)).unwrap();
        }
        let restarted = FileIngress::default();
        let snapshot = restarted.list(root.path(), owner).unwrap();
        assert_eq!(snapshot.recent.len(), MAX_RECENT);
        assert!(
            matches!(&snapshot.recent[0], FileIngressItem::File { name, .. } if name == "20.txt")
        );
        assert!(
            restarted
                .list(root.path(), Id::new())
                .unwrap()
                .recent
                .is_empty()
        );
        restarted
            .reopen(
                root.path(),
                owner,
                FileIngressId {
                    id: file_id(&snapshot.recent[0]).into(),
                },
            )
            .unwrap();
        let pending = restarted.list(root.path(), owner).unwrap().pending;
        restarted
            .claim(
                root.path(),
                owner,
                &picked,
                FileIngressClaim {
                    id: file_id(&pending[0]).into(),
                    purpose: FileIngressPurpose::Store,
                },
            )
            .unwrap();
        assert_eq!(
            restarted.list(root.path(), owner).unwrap().recent.len(),
            MAX_RECENT
        );
    }

    #[test]
    fn claim_revalidates_file_and_rolls_back_token_when_recent_write_fails() {
        let root = root();
        let ingress = FileIngress::default();
        let owner = Id::new();
        let picked = PickedFileStore::default();
        let path = root.path().join("data.csv");
        fs::write(&path, b"text").unwrap();
        ingress
            .enqueue_paths(std::slice::from_ref(&path), None)
            .unwrap();
        let pending = ingress.list(root.path(), owner).unwrap().pending;
        let id = file_id(&pending[0]);
        fs::remove_file(&path).unwrap();
        assert_eq!(
            ingress
                .claim(
                    root.path(),
                    owner,
                    &picked,
                    FileIngressClaim {
                        id: id.into(),
                        purpose: FileIngressPurpose::Import
                    }
                )
                .unwrap_err()
                .code(),
            UNAVAILABLE
        );
        fs::write(&path, b"text").unwrap();
        fs::write(root.path().join("Temp"), b"blocked").unwrap();
        assert_eq!(
            ingress
                .claim(
                    root.path(),
                    owner,
                    &picked,
                    FileIngressClaim {
                        id: id.into(),
                        purpose: FileIngressPurpose::Import
                    }
                )
                .unwrap_err()
                .code(),
            IO_FAILED
        );
        crate::picked_files::tests::assert_empty(&picked);
        assert_eq!(ingress.list(root.path(), owner).unwrap().pending.len(), 1);
        assert!(ingress.list(root.path(), owner).unwrap().recent.is_empty());
        fs::remove_file(root.path().join("Temp")).unwrap();
        let file = ingress
            .claim(
                root.path(),
                owner,
                &picked,
                FileIngressClaim {
                    id: id.into(),
                    purpose: FileIngressPurpose::Import,
                },
            )
            .unwrap();
        assert_eq!(
            picked
                .take(&file.token, Actor::User(owner), FilePurpose::Import, None)
                .unwrap()
                .format,
            Some(tenon_framework::exchange::ExchangeFormat::Csv)
        );
    }

    #[test]
    #[cfg(windows)]
    fn junction_parent_paths_are_rejected() {
        let root = root();
        let real = root.path().join("real");
        fs::create_dir(&real).unwrap();
        fs::write(real.join("data.txt"), b"text").unwrap();
        let link = root.path().join("link");
        crate::state_root::tests::link_directory(&real, &link);
        assert_eq!(
            FileIngress::default()
                .enqueue_paths(&[link.join("data.txt")], None)
                .unwrap_err()
                .code(),
            INVALID
        );
    }

    fn root() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("file-ingress-")
            .tempdir_in(std::env::temp_dir())
            .unwrap()
    }
    fn file_id(item: &FileIngressItem) -> &str {
        match item {
            FileIngressItem::File { id, .. } => id,
            _ => panic!("expected file"),
        }
    }

    #[test]
    fn pending_claim_and_recent_are_explicit_actor_scoped_and_revalidated() {
        let root = root();
        let path = root.path().join("note.txt");
        fs::write(&path, b"private body").unwrap();
        let ingress = FileIngress::default();
        let owner = Id::new();
        let other = Id::new();
        let picked = PickedFileStore::default();
        ingress
            .enqueue_paths(std::slice::from_ref(&path), None)
            .unwrap();
        let initial = ingress.list(root.path(), owner).unwrap();
        assert_eq!(initial.pending.len(), 1);
        assert!(initial.recent.is_empty());
        assert!(
            !serde_json::to_string(&initial)
                .unwrap()
                .contains("private body")
        );
        assert!(
            !serde_json::to_string(&initial)
                .unwrap()
                .contains(&root.path().to_string_lossy().to_string())
        );
        let id = file_id(&initial.pending[0]).to_owned();
        assert!(ingress.list(root.path(), other).unwrap().pending.is_empty());
        assert_eq!(
            ingress
                .claim(
                    root.path(),
                    other,
                    &picked,
                    FileIngressClaim {
                        id: id.clone(),
                        purpose: FileIngressPurpose::Store
                    }
                )
                .err()
                .unwrap()
                .code(),
            UNAVAILABLE
        );
        let token = ingress
            .claim(
                root.path(),
                owner,
                &picked,
                FileIngressClaim {
                    id,
                    purpose: FileIngressPurpose::Store,
                },
            )
            .unwrap();
        assert_eq!(
            picked
                .take(&token.token, Actor::User(owner), FilePurpose::Store, None)
                .unwrap()
                .path,
            path.canonicalize().unwrap()
        );
        let after = ingress.list(root.path(), owner).unwrap();
        assert!(after.pending.is_empty());
        assert_eq!(after.recent.len(), 1);
        assert!(ingress.list(root.path(), other).unwrap().recent.is_empty());
        fs::remove_file(&path).unwrap();
        assert_eq!(
            ingress
                .reopen(
                    root.path(),
                    owner,
                    FileIngressId {
                        id: file_id(&after.recent[0]).into()
                    }
                )
                .unwrap_err()
                .code(),
            UNAVAILABLE
        );
        ingress
            .dismiss(
                root.path(),
                owner,
                FileIngressDismiss {
                    ids: Vec::new(),
                    clear_recent: true,
                },
            )
            .unwrap();
        assert!(ingress.list(root.path(), owner).unwrap().recent.is_empty());
    }

    #[test]
    fn directory_budget_is_one_level_and_rejection_does_not_partially_enqueue() {
        let root = root();
        let folder = root.path().join("batch");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("first.csv"), b"not read").unwrap();
        fs::create_dir(folder.join("child")).unwrap();
        fs::write(folder.join("child/deep.csv"), b"not scanned").unwrap();
        let ingress = FileIngress::default();
        let owner = Id::new();
        ingress
            .enqueue_paths(std::slice::from_ref(&folder), None)
            .unwrap();
        let snapshot = ingress.list(root.path(), owner).unwrap();
        assert_eq!(snapshot.pending.len(), 1);
        assert_eq!(snapshot.skipped_directories, 1);
        ingress
            .dismiss(
                root.path(),
                owner,
                FileIngressDismiss {
                    ids: vec![file_id(&snapshot.pending[0]).into()],
                    clear_recent: false,
                },
            )
            .unwrap();
        for index in 0..16 {
            fs::write(folder.join(format!("more-{index}.txt")), b"text").unwrap();
        }
        assert_eq!(
            ingress
                .enqueue_paths(std::slice::from_ref(&folder), None)
                .unwrap_err()
                .code(),
            LIMIT
        );
        assert!(ingress.list(root.path(), owner).unwrap().pending.is_empty());
        let backup = root.path().join("unsafe.tenon-backup.zip");
        fs::write(&backup, b"not restored").unwrap();
        assert_eq!(
            ingress.enqueue_paths(&[backup], None).unwrap_err().code(),
            INVALID
        );
        assert!(ingress.list(root.path(), owner).unwrap().pending.is_empty());
    }

    #[test]
    fn recent_schema_failure_requires_explicit_clear_and_routes_are_bounded() {
        let root = root();
        let owner = Id::new();
        let ingress = FileIngress::default();
        fs::create_dir(root.path().join("recent-files")).unwrap();
        fs::write(recent_path(root.path(), owner), b"broken").unwrap();
        assert_eq!(
            ingress.list(root.path(), owner).unwrap_err().code(),
            RECENT_INVALID
        );
        ingress
            .dismiss(
                root.path(),
                owner,
                FileIngressDismiss {
                    ids: vec![],
                    clear_recent: true,
                },
            )
            .unwrap();
        for invalid in [
            "sample",
            "/sample/../files",
            "/%2e%2e/files",
            "/sample?command=delete",
            "/sample#fragment",
            "/sample//files",
        ] {
            assert_eq!(
                ingress.enqueue_route(invalid, None).unwrap_err().code(),
                INVALID
            );
        }
        assert!(ingress.list(root.path(), owner).unwrap().pending.is_empty());
        ingress.enqueue_route("/sample/items", None).unwrap();
        assert!(
            matches!(&ingress.list(root.path(), owner).unwrap().pending[0], FileIngressItem::Route { path, .. } if path == "/sample/items")
        );
    }

    #[test]
    fn secondary_launch_intents_only_reach_the_requested_state_root() {
        let root = root();
        let owner = Id::new();
        let other = root.path().join("other-state");
        fs::create_dir(&other).unwrap();
        let file = root.path().join("valid.txt");
        fs::write(&file, b"text").unwrap();
        let ingress = FileIngress::default();
        ingress
            .enqueue_paths(
                std::slice::from_ref(&file),
                Some(other.canonicalize().unwrap()),
            )
            .unwrap();
        ingress
            .enqueue_route("/sample/items", Some(other.canonicalize().unwrap()))
            .unwrap();
        ingress
            .enqueue_paths(
                std::slice::from_ref(&file),
                Some(root.path().canonicalize().unwrap()),
            )
            .unwrap();
        let snapshot = ingress.list(root.path(), owner).unwrap();
        assert_eq!(snapshot.pending.len(), 1);
        assert!(
            matches!(&snapshot.pending[0], FileIngressItem::File { name, .. } if name == "valid.txt")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_in_files_or_parent_directories_are_rejected() {
        let root = root();
        let real = root.path().join("real");
        fs::create_dir(&real).unwrap();
        fs::write(real.join("note.txt"), b"text").unwrap();
        std::os::unix::fs::symlink(&real, root.path().join("link-dir")).unwrap();
        std::os::unix::fs::symlink(real.join("note.txt"), root.path().join("link.txt")).unwrap();
        let ingress = FileIngress::default();
        assert_eq!(
            ingress
                .enqueue_paths(&[root.path().join("link-dir/note.txt")], None)
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(
            ingress
                .enqueue_paths(&[root.path().join("link.txt")], None)
                .unwrap_err()
                .code(),
            INVALID
        );
    }
}
