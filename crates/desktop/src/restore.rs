//! 启动前的持久恢复事务。这里不持有 AppState，也不打开目标数据库。
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tenon_framework::{
    backup::{
        self, Cancellation, RESTORE_FAILED, ROLLBACK_FAILED,
        restore::{Digest, collect_files, digest},
    },
    error::AppError,
};
use ts_rs::TS;

const JOURNAL: &str = "restore-journal.json";
const MEMBERS: [&str; 5] = [
    "data/app.db",
    "data/app.db-wal",
    "data/app.db-shm",
    "config.toml",
    "files",
];
const NEW_MEMBERS: [usize; 3] = [0, 3, 4];
const JOURNAL_LIMIT: u64 = 4 * 1024 * 1024;
const JOURNAL_PERSIST_RETRIES: u32 = 20;
const JOURNAL_PERSIST_MAX_WAIT: Duration = Duration::from_secs(1);

/// 产品切换对象的摘要；通用附件校验仍由 framework 执行。
pub(crate) fn member_digests(
    root: &Path,
    cancel: &Cancellation,
) -> Result<BTreeMap<String, Digest>, AppError> {
    let wal = root.join("data/app.db-wal");
    backup::regular_path(&wal, true)?;
    match fs::metadata(&wal) {
        Ok(metadata) if metadata.is_file() && metadata.len() == 0 => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        _ => return Err(AppError::new(backup::INVALID_ARCHIVE)),
    }
    let mut members = BTreeMap::new();
    for (name, limit) in [
        ("data/app.db", backup::MAX_DATABASE),
        ("config.toml", backup::MAX_MANIFEST),
    ] {
        members.insert(name.into(), digest(&root.join(name), limit, cancel)?);
    }
    let mut bytes = members.values().map(|entry| entry.bytes).sum();
    collect_files(root, &root.join("files"), &mut members, &mut bytes, cancel)?;
    if members.len() + 1 > backup::MAX_ENTRIES || bytes > backup::MAX_TOTAL {
        return Err(AppError::new(backup::TOO_LARGE));
    }
    Ok(members)
}

pub(crate) fn check_layout(root: &Path, scratch: &Path) -> Result<(), AppError> {
    backup::check_layout(root, scratch)?;
    let root = fs::canonicalize(root).map_err(|_| AppError::new(backup::STORAGE_UNSUPPORTED))?;
    let scratch =
        fs::canonicalize(scratch).map_err(|_| AppError::new(backup::STORAGE_UNSUPPORTED))?;
    if scratch.starts_with(root.join("files")) || scratch.starts_with(root.join("data")) {
        return Err(AppError::new(backup::STORAGE_UNSUPPORTED));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub status: RestoreStatus,
    pub code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum RestoreStatus {
    Succeeded,
    RolledBack,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Prepared,
    OldMoved,
    NewInstalled,
    Validated,
    Committed,
    RolledBack,
    Failed,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u8,
    operation_id: String,
    root_digest: String,
    scratch_digest: String,
    app_version: String,
    instance: Digest,
    members: BTreeMap<String, Digest>,
    original: Option<[bool; 5]>,
    phase: Phase,
}

/// 校验宿主 --restore-prepared 的只读输入；与恢复日志使用同一标识合同。
pub fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn path_digest(path: &Path) -> Result<String, AppError> {
    let path = fs::canonicalize(backup::regular_path(path, false)?)
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    let text = path.to_str().ok_or_else(|| AppError::new(RESTORE_FAILED))?;
    #[cfg(windows)]
    let text = text.to_lowercase();
    Ok(format!("{:x}", Sha256::digest(text.as_bytes())))
}

pub(crate) fn operation_directory(scratch: &Path, id: &str) -> Result<PathBuf, AppError> {
    if !valid_id(id) {
        return Err(AppError::new(RESTORE_FAILED));
    }
    backup::regular_path(&scratch.join(id), false)
}

fn load(root: &Path) -> Result<Option<Journal>, AppError> {
    let path = root.join(JOURNAL);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AppError::new(RESTORE_FAILED)),
        Ok(_) => {}
    }
    backup::regular_path(&path, true)?;
    let file = File::open(path).map_err(|_| AppError::new(RESTORE_FAILED))?;
    let mut bytes = Vec::new();
    file.take(JOURNAL_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    if bytes.len() as u64 > JOURNAL_LIMIT {
        return Err(AppError::new(RESTORE_FAILED));
    }
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|_| AppError::new(RESTORE_FAILED))?;
    if journal.version != 1
        || !valid_id(&journal.operation_id)
        || journal.root_digest != path_digest(root)?
        || journal.original.is_some_and(|original| !original[0])
        || (matches!(
            journal.phase,
            Phase::OldMoved | Phase::NewInstalled | Phase::Validated | Phase::Committed
        ) && journal.original.is_none())
    {
        return Err(AppError::new(RESTORE_FAILED));
    }
    Ok(Some(journal))
}

// 仅重试 Windows 错误码 5（ERROR_ACCESS_DENIED），依据是实测瞬时拒绝访问。
fn retry_journal_persist<T>(
    mut operation: impl FnMut() -> io::Result<T>,
    mut wait: impl FnMut(Duration),
) -> io::Result<T> {
    let mut retries = 0;
    loop {
        match operation() {
            Err(error)
                if cfg!(windows)
                    && retries < JOURNAL_PERSIST_RETRIES
                    && error.raw_os_error() == Some(5) =>
            {
                retries += 1;
                wait(JOURNAL_PERSIST_MAX_WAIT / JOURNAL_PERSIST_RETRIES);
            }
            result => return result,
        }
    }
}

fn persist(root: &Path, operation: &Path, journal: &Journal) -> Result<(), AppError> {
    backup::regular_path(&root.join(JOURNAL), true)?;
    let bytes = serde_json::to_vec(journal).map_err(|_| AppError::new(RESTORE_FAILED))?;
    if bytes.len() as u64 > JOURNAL_LIMIT {
        return Err(AppError::new(RESTORE_FAILED));
    }
    let mut file =
        tempfile::NamedTempFile::new_in(operation).map_err(|_| AppError::new(RESTORE_FAILED))?;
    file.write_all(&bytes)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|_| AppError::new(RESTORE_FAILED))?;
    // Windows 上替换日志偶发 ERROR_ACCESS_DENIED（实测等待 50ms 后恢复），失败时保留同一临时文件有界重试。
    let mut pending = Some(file);
    retry_journal_persist(
        || match pending
            .take()
            .ok_or_else(|| io::Error::other("journal retry already completed"))?
            .persist(root.join(JOURNAL))
        {
            Ok(file) => Ok(file),
            Err(error) => {
                pending = Some(error.file);
                Err(error.error)
            }
        },
        std::thread::sleep,
    )
    .map_err(|_| AppError::new(RESTORE_FAILED))?
    .sync_all()
    .map_err(|_| AppError::new(RESTORE_FAILED))?;
    Ok(())
}

pub(crate) fn record(
    root: &Path,
    scratch: &Path,
    id: &str,
    members: BTreeMap<String, Digest>,
) -> Result<(), AppError> {
    check_layout(root, scratch)?;
    if load(root)?.is_some_and(|j| !matches!(j.phase, Phase::Committed | Phase::RolledBack)) {
        return Err(AppError::new(RESTORE_FAILED));
    }
    let operation = operation_directory(scratch, id)?;
    if member_digests(&operation.join("stage"), &Cancellation::default())? != members {
        return Err(AppError::new(backup::HASH_MISMATCH));
    }
    for name in ["rollback", "displaced"] {
        fs::create_dir(operation.join(name)).map_err(|_| AppError::new(RESTORE_FAILED))?;
    }
    persist(
        root,
        &operation,
        &Journal {
            version: 1,
            operation_id: id.into(),
            root_digest: path_digest(root)?,
            scratch_digest: path_digest(scratch)?,
            app_version: env!("CARGO_PKG_VERSION").into(),
            instance: digest(&root.join("instance-id"), 128, &Cancellation::default())?,
            members,
            original: None,
            phase: Phase::Prepared,
        },
    )
}

pub fn last_result(root: &Path) -> Result<Option<RestoreResult>, AppError> {
    Ok(load(root)?.map(|j| result(j.phase)))
}

fn result(phase: Phase) -> RestoreResult {
    match phase {
        Phase::Committed => RestoreResult {
            status: RestoreStatus::Succeeded,
            code: None,
        },
        Phase::RolledBack => RestoreResult {
            status: RestoreStatus::RolledBack,
            code: Some(RESTORE_FAILED.as_str().into()),
        },
        _ => RestoreResult {
            status: RestoreStatus::Failed,
            code: Some(ROLLBACK_FAILED.as_str().into()),
        },
    }
}

/// 只有匹配的一次性内部启动参数才能开始 Prepared；其余未提交状态优先回滚。
pub fn before_start(root: &Path, scratch: &Path, prepared: Option<&str>) -> Result<(), AppError> {
    recover(root, scratch, prepared, &mut || Ok(()))
}

fn recover(
    root: &Path,
    scratch: &Path,
    prepared: Option<&str>,
    checkpoint: &mut impl FnMut() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let Some(mut journal) = load(root)? else {
        return if prepared.is_none() {
            Ok(())
        } else {
            Err(AppError::new(RESTORE_FAILED))
        };
    };
    if prepared.is_some_and(|id| id != journal.operation_id)
        || digest(&root.join("instance-id"), 128, &Cancellation::default())? != journal.instance
    {
        return Err(AppError::new(RESTORE_FAILED));
    }
    if (journal.original.is_none() || matches!(journal.phase, Phase::Committed | Phase::RolledBack))
        && !backup::regular_path(&root.join("data/app.db"), false).is_ok_and(|path| path.is_file())
    {
        return Err(AppError::new(ROLLBACK_FAILED));
    }
    if matches!(journal.phase, Phase::Committed | Phase::RolledBack) {
        return Ok(());
    }
    check_layout(root, scratch)?;
    if journal.scratch_digest != path_digest(scratch)? {
        return Err(AppError::new(RESTORE_FAILED));
    }
    let operation = operation_directory(scratch, &journal.operation_id)?;
    backup::regular_path(&operation.join("rollback"), false)?;
    backup::regular_path(&operation.join("displaced"), false)?;
    let can_begin = journal.phase == Phase::Prepared
        && journal.original.is_none()
        && prepared == Some(journal.operation_id.as_str())
        && journal.app_version == env!("CARGO_PKG_VERSION");
    if can_begin {
        let installed = install(root, &operation, &mut journal, checkpoint);
        if installed.is_ok() {
            return Ok(());
        }
    }
    if rollback(root, &operation, &mut journal, checkpoint).is_err() {
        journal.phase = Phase::Failed;
        // 无法记录失败仍须停止启动，原记录和磁盘事实继续作为下一次回滚证据。
        let _ = persist(root, &operation, &journal);
        return Err(AppError::new(ROLLBACK_FAILED));
    }
    Ok(())
}

fn install(
    root: &Path,
    operation: &Path,
    journal: &mut Journal,
    checkpoint: &mut impl FnMut() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let cancel = Cancellation::default();
    let stage = operation.join("stage");
    if digest(&root.join("instance-id"), 128, &cancel)? != journal.instance
        || member_digests(&stage, &cancel)? != journal.members
    {
        return Err(AppError::new(backup::HASH_MISMATCH));
    }
    let mut original = [false; 5];
    for (index, name) in MEMBERS.iter().enumerate() {
        let path = root.join(name);
        backup::regular_path(&path, true)?;
        original[index] = path
            .try_exists()
            .map_err(|_| AppError::new(RESTORE_FAILED))?;
    }
    if !original[0] || !root.join("data/app.db").is_file() {
        return Err(AppError::new(RESTORE_FAILED));
    }
    journal.original = Some(original);
    persist(root, operation, journal)?;
    checkpoint()?;
    for (index, name) in MEMBERS.iter().enumerate() {
        if original[index] {
            move_member(
                &root.join(name),
                &operation.join("rollback").join(index.to_string()),
            )?;
            checkpoint()?;
            persist(root, operation, journal)?;
            checkpoint()?;
        }
    }
    journal.phase = Phase::OldMoved;
    persist(root, operation, journal)?;
    checkpoint()?;
    for index in NEW_MEMBERS {
        move_member(&stage.join(MEMBERS[index]), &root.join(MEMBERS[index]))?;
        checkpoint()?;
        persist(root, operation, journal)?;
        checkpoint()?;
    }
    journal.phase = Phase::NewInstalled;
    persist(root, operation, journal)?;
    checkpoint()?;
    if member_digests(root, &cancel)? != journal.members
        || digest(&root.join("instance-id"), 128, &cancel)? != journal.instance
    {
        return Err(AppError::new(backup::HASH_MISMATCH));
    }
    journal.phase = Phase::Validated;
    persist(root, operation, journal)?;
    checkpoint()?;
    journal.phase = Phase::Committed;
    persist(root, operation, journal)?;
    Ok(())
}

fn move_member(from: &Path, to: &Path) -> Result<(), AppError> {
    backup::regular_path(from, false)?;
    backup::regular_path(to, true)?;
    if to.try_exists().map_err(|_| AppError::new(RESTORE_FAILED))? {
        return Err(AppError::new(RESTORE_FAILED));
    }
    fs::rename(from, to).map_err(|_| AppError::new(RESTORE_FAILED))
}

fn rollback(
    root: &Path,
    operation: &Path,
    journal: &mut Journal,
    checkpoint: &mut impl FnMut() -> Result<(), AppError>,
) -> Result<(), AppError> {
    if let Some(original) = journal.original {
        for (index, name) in MEMBERS.iter().enumerate().rev() {
            let target = root.join(name);
            let old = operation.join("rollback").join(index.to_string());
            backup::regular_path(&target, true)?;
            backup::regular_path(&old, true)?;
            let has_old = old
                .try_exists()
                .map_err(|_| AppError::new(ROLLBACK_FAILED))?;
            if has_old || !original[index] {
                if target
                    .try_exists()
                    .map_err(|_| AppError::new(ROLLBACK_FAILED))?
                {
                    move_member(
                        &target,
                        &operation.join("displaced").join(index.to_string()),
                    )?;
                    checkpoint()?;
                }
                if has_old {
                    move_member(&old, &target)?;
                    checkpoint()?;
                }
            } else if !target
                .try_exists()
                .map_err(|_| AppError::new(ROLLBACK_FAILED))?
            {
                return Err(AppError::new(ROLLBACK_FAILED));
            }
            persist(root, operation, journal)?;
            checkpoint()?;
        }
    }
    journal.phase = Phase::RolledBack;
    persist(root, operation, journal)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef";

    #[cfg(windows)]
    #[test]
    fn journal_persist_recovers_within_retry_budget() {
        for failures in [0, 1, 3, JOURNAL_PERSIST_RETRIES] {
            let mut attempts = 0;
            let mut waits = Vec::new();
            let value = retry_journal_persist(
                || {
                    attempts += 1;
                    if attempts <= failures {
                        Err(io::Error::from_raw_os_error(5))
                    } else {
                        Ok("persisted")
                    }
                },
                |duration| waits.push(duration),
            )
            .unwrap();
            assert_eq!(value, "persisted");
            assert_eq!(attempts, failures + 1);
            assert_eq!(waits, vec![Duration::from_millis(50); failures as usize]);
        }
    }

    #[cfg(windows)]
    #[test]
    fn journal_persist_stops_at_retry_limit() {
        let mut attempts = 0;
        let mut waits = Vec::new();
        let error = retry_journal_persist::<()>(
            || {
                attempts += 1;
                Err(io::Error::from_raw_os_error(5))
            },
            |duration| waits.push(duration),
        )
        .unwrap_err();
        assert_eq!(error.raw_os_error(), Some(5));
        assert_eq!(attempts, JOURNAL_PERSIST_RETRIES + 1);
        assert_eq!(waits.len(), JOURNAL_PERSIST_RETRIES as usize);
        assert_eq!(waits.iter().sum::<Duration>(), JOURNAL_PERSIST_MAX_WAIT);
        assert!(waits.iter().sum::<Duration>() <= Duration::from_secs(2));
    }

    #[test]
    fn journal_persist_returns_success_and_other_errors_without_waiting() {
        assert_eq!(
            retry_journal_persist(|| Ok(42), |_| panic!("success must not wait")).unwrap(),
            42
        );
        let errors = [
            io::Error::from(io::ErrorKind::PermissionDenied),
            io::Error::new(io::ErrorKind::PermissionDenied, "x"),
            io::Error::from(io::ErrorKind::NotFound),
            io::Error::from_raw_os_error(19),
            io::Error::from_raw_os_error(32),
            io::Error::from_raw_os_error(33),
            io::Error::from_raw_os_error(87),
            #[cfg(not(windows))]
            io::Error::from_raw_os_error(5),
        ];
        for error in errors {
            let kind = error.kind();
            let code = error.raw_os_error();
            let mut pending = Some(error);
            let mut attempts = 0;
            let returned = retry_journal_persist::<()>(
                || {
                    attempts += 1;
                    Err(pending.take().expect("error must not be retried"))
                },
                |_| panic!("non-transient error must not wait"),
            )
            .unwrap_err();
            assert_eq!(attempts, 1);
            assert_eq!(returned.kind(), kind);
            assert_eq!(returned.raw_os_error(), code);
        }
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP")).unwrap();
        let root = temp.path().join("target");
        let scratch = temp.path().join("scratch");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::create_dir_all(root.join("files/2026/10")).unwrap();
        let attachment = format!("files/2026/10/{}", tenon_framework::id::Id::new());
        for (name, contents) in [
            ("data/app.db", b"old database".as_slice()),
            ("data/app.db-wal", b"old wal"),
            ("data/app.db-shm", b"old shm"),
            ("config.toml", b"old config"),
            ("instance-id", b"target-instance\n"),
            ("workbench.json", b"device workbench"),
            ("window-state.json", b"device geometry"),
            (&attachment, b"old attachment"),
        ] {
            fs::write(root.join(name), contents).unwrap();
        }
        let stage = scratch.join(ID).join("stage");
        fs::create_dir_all(stage.join("data")).unwrap();
        fs::create_dir_all(stage.join("files/2026/10")).unwrap();
        fs::write(stage.join("data/app.db"), b"new database").unwrap();
        fs::write(stage.join("config.toml"), b"new config").unwrap();
        fs::write(stage.join(&attachment), b"new attachment").unwrap();
        let members = member_digests(&stage, &Cancellation::default()).unwrap();
        record(&root, &scratch, ID, members).unwrap();
        (temp, root, scratch)
    }

    fn assert_old(root: &Path) {
        for (name, contents) in [
            ("data/app.db", b"old database".as_slice()),
            ("data/app.db-wal", b"old wal"),
            ("data/app.db-shm", b"old shm"),
            ("config.toml", b"old config"),
            ("instance-id", b"target-instance\n"),
            ("workbench.json", b"device workbench"),
            ("window-state.json", b"device geometry"),
        ] {
            assert_eq!(fs::read(root.join(name)).unwrap(), contents, "{name}");
        }
        for entry in fs::read_dir(root.join("files/2026/10")).unwrap() {
            assert_eq!(fs::read(entry.unwrap().path()).unwrap(), b"old attachment");
        }
    }

    #[test]
    fn restore_journal_recovers_every_boundary() {
        let (_temp, root, scratch) = fixture();
        let mut boundaries = 0;
        recover(&root, &scratch, Some(ID), &mut || {
            boundaries += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(boundaries, 20);
        assert_eq!(fs::read(root.join("data/app.db")).unwrap(), b"new database");
        assert!(!root.join("data/app.db-wal").exists());
        assert!(!root.join("data/app.db-shm").exists());
        assert_eq!(
            last_result(&root).unwrap().unwrap().status,
            RestoreStatus::Succeeded
        );
        before_start(&root, &scratch, Some(ID)).unwrap();
        assert_eq!(
            fs::read(root.join("instance-id")).unwrap(),
            b"target-instance\n"
        );
        assert_eq!(
            fs::read(root.join("window-state.json")).unwrap(),
            b"device geometry"
        );
        assert!(scratch.join(ID).join("rollback/0").exists());

        for crash in [false, true] {
            for boundary in 1..=boundaries {
                let (_temp, root, scratch) = fixture();
                let mut seen = 0;
                let attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    recover(&root, &scratch, Some(ID), &mut || {
                        seen += 1;
                        if seen == boundary {
                            assert!(!crash, "simulated process loss at boundary {boundary}");
                            return Err(AppError::new(RESTORE_FAILED));
                        }
                        Ok(())
                    })
                }));
                if crash {
                    assert!(attempt.is_err());
                } else {
                    attempt.unwrap().unwrap();
                }
                before_start(&root, &scratch, None).unwrap();
                assert_old(&root);
                assert_eq!(
                    last_result(&root).unwrap().unwrap().status,
                    RestoreStatus::RolledBack
                );
                before_start(&root, &scratch, None).unwrap();
                assert_old(&root);
            }
        }
    }

    #[test]
    fn rollback_interruption_and_failure_stop_without_creating_a_database() {
        // 各回滚改名/日志边界均可继续；失败不允许进入正常启动。
        for boundary in 1..=13 {
            let (_temp, root, scratch) = fixture();
            let mut seen = 0;
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                recover(&root, &scratch, Some(ID), &mut || {
                    seen += 1;
                    assert!(seen != 18, "interrupted after new installation");
                    Ok(())
                })
            }));
            let mut rollback_seen = 0;
            let interrupted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                recover(&root, &scratch, None, &mut || {
                    rollback_seen += 1;
                    assert!(rollback_seen != boundary, "interrupted rollback");
                    Ok(())
                })
            }));
            assert!(
                interrupted.is_err(),
                "rollback boundary {boundary} was not reached"
            );
            before_start(&root, &scratch, None).unwrap();
            assert_old(&root);
        }
        let (_temp, root, scratch) = fixture();
        let mut seen = 0;
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            recover(&root, &scratch, Some(ID), &mut || {
                seen += 1;
                assert!(seen != 3, "interrupted old database move");
                Ok(())
            })
        }));
        let old = scratch.join(ID).join("rollback/0");
        fs::rename(&old, scratch.join(ID).join("missing-evidence")).unwrap();
        assert_eq!(
            before_start(&root, &scratch, None).unwrap_err().code(),
            ROLLBACK_FAILED
        );
        assert!(!root.join("data/app.db").exists());
        assert_eq!(
            last_result(&root).unwrap().unwrap().status,
            RestoreStatus::Failed
        );
        fs::rename(scratch.join(ID).join("missing-evidence"), old).unwrap();
        before_start(&root, &scratch, None).unwrap();
        assert_old(&root);
    }

    #[test]
    fn startup_rejects_tampered_stage_root_instance_and_journal() {
        let (_temp, root, scratch) = fixture();
        fs::write(scratch.join(ID).join("stage/data/app.db"), b"changed").unwrap();
        before_start(&root, &scratch, Some(ID)).unwrap();
        assert_old(&root);
        assert_eq!(
            last_result(&root).unwrap().unwrap().status,
            RestoreStatus::RolledBack
        );
        let (_temp, root, scratch) = fixture();
        fs::write(root.join("instance-id"), b"different\n").unwrap();
        assert!(before_start(&root, &scratch, Some(ID)).is_err());
        let (_temp, root, scratch) = fixture();
        let mut document: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(JOURNAL)).unwrap()).unwrap();
        document["operationId"] = "../escape".into();
        fs::write(root.join(JOURNAL), serde_json::to_vec(&document).unwrap()).unwrap();
        assert!(before_start(&root, &scratch, Some(ID)).is_err());
        assert_old(&root);
        let (_temp, root, scratch) = fixture();
        fs::rename(root.join("data/app.db"), root.join("saved-for-test.db")).unwrap();
        assert_eq!(
            before_start(&root, &scratch, Some(ID)).unwrap_err().code(),
            ROLLBACK_FAILED
        );
        assert!(!root.join("data/app.db").exists());
        let (_temp, root, scratch) = fixture();
        let mut document: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(JOURNAL)).unwrap()).unwrap();
        document["phase"] = "oldMoved".into();
        fs::write(root.join(JOURNAL), serde_json::to_vec(&document).unwrap()).unwrap();
        assert!(before_start(&root, &scratch, None).is_err());
        assert_old(&root);
    }

    #[test]
    fn missing_committed_database_and_invalid_journal_preserve_evidence() {
        let (_temp, root, scratch) = fixture();
        before_start(&root, &scratch, Some(ID)).unwrap();
        fs::rename(root.join("data/app.db"), root.join("saved-database")).unwrap();
        let bytes = fs::read(root.join(JOURNAL)).unwrap();
        assert_eq!(
            before_start(&root, &scratch, None).unwrap_err().code(),
            ROLLBACK_FAILED
        );
        assert!(!root.join("data/app.db").exists());
        assert_eq!(fs::read(root.join(JOURNAL)).unwrap(), bytes);
        assert!(scratch.join(ID).join("rollback/0").is_file());
        for bytes in [b"broken".to_vec(), vec![b' '; JOURNAL_LIMIT as usize + 1]] {
            fs::write(root.join(JOURNAL), &bytes).unwrap();
            assert_eq!(
                before_start(&root, &scratch, None).unwrap_err().code(),
                RESTORE_FAILED
            );
            assert_eq!(fs::read(root.join(JOURNAL)).unwrap(), bytes);
        }
    }

    #[test]
    fn unaccepted_prepare_and_changed_version_roll_back_without_installing() {
        for change_version in [false, true] {
            let (_temp, root, scratch) = fixture();
            if change_version {
                let mut journal = load(&root).unwrap().unwrap();
                journal.app_version = "different".into();
                persist(&root, &scratch.join(ID), &journal).unwrap();
            }
            before_start(&root, &scratch, change_version.then_some(ID)).unwrap();
            assert_old(&root);
            assert_eq!(
                last_result(&root).unwrap().unwrap().status,
                RestoreStatus::RolledBack
            );
        }
        let (_temp, root, scratch) = fixture();
        assert!(before_start(&root, &scratch, Some("ffffffffffffffffffffffffffffffff")).is_err());
        assert_old(&root);
        let mut journal = load(&root).unwrap().unwrap();
        journal.root_digest = "changed".into();
        persist(&root, &scratch.join(ID), &journal).unwrap();
        assert!(before_start(&root, &scratch, Some(ID)).is_err());
        assert_old(&root);
    }
}
