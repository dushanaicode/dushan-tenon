use super::*;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

/// 所有现存路径分量均拒绝链接/联接；允许仅最终文件尚不存在。
pub fn regular_path(path: &Path, missing_leaf: bool) -> Result<PathBuf, AppError> {
    let absolute = std::path::absolute(path).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
    let mut current = PathBuf::new();
    for part in absolute.components() {
        if matches!(part, Component::ParentDir | Component::CurDir) {
            return Err(AppError::new(STORAGE_UNSUPPORTED));
        }
        current.push(part);
        if matches!(part, Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) if !is_link(&meta) => {}
            Err(e)
                if missing_leaf
                    && current == absolute
                    && e.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(AppError::new(STORAGE_UNSUPPORTED)),
        }
    }
    let parent = absolute
        .parent()
        .ok_or_else(|| AppError::new(STORAGE_UNSUPPORTED))?;
    let canonical = fs::canonicalize(parent).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
    Ok(canonical.join(
        absolute
            .file_name()
            .ok_or_else(|| AppError::new(STORAGE_UNSUPPORTED))?,
    ))
}

pub(super) fn same_volume(a: &Path, b: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        // canonicalize 解析盘符映射；regular_path 已拒绝卷挂载点/联接。
        let a = fs::canonicalize(a).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
        let b = fs::canonicalize(b).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
        if a.components().next() != b.components().next() {
            return Err(AppError::new(STORAGE_UNSUPPORTED));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if fs::metadata(a)
            .map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?
            .dev()
            != fs::metadata(b)
                .map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?
                .dev()
        {
            return Err(AppError::new(STORAGE_UNSUPPORTED));
        }
    }
    Ok(())
}

/// scratch 是宿主构造的显式 Temp 路径，不能来自 IPC；测试注入本轮隔离目录。
pub fn check_layout(state_root: &Path, scratch: &Path) -> Result<(), AppError> {
    regular_path(state_root, false)?;
    let parent = scratch
        .parent()
        .ok_or_else(|| AppError::new(STORAGE_UNSUPPORTED))?;
    match fs::symlink_metadata(parent) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // 首次运行可以创建宿主指定的 Temp；先检查现存祖先，不能经联接创建。
            regular_path(parent, true)?;
            fs::create_dir_all(parent).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
        }
        Err(_) => return Err(AppError::new(STORAGE_UNSUPPORTED)),
        Ok(_) => {}
    }
    regular_path(scratch, true)?;
    fs::create_dir_all(scratch).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
    regular_path(scratch, false)?;
    same_volume(state_root, scratch)?;
    let probe =
        tempfile::NamedTempFile::new_in(scratch).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
    probe
        .close()
        .map_err(|_| AppError::new(STORAGE_UNSUPPORTED))
}

#[derive(PartialEq, Eq)]
struct Fingerprint {
    bytes: u64,
    created: SystemTime,
    modified: SystemTime,
    hash: String,
}

fn fingerprint(path: &Path, cancel: &Cancellation) -> Result<Option<Fingerprint>, AppError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AppError::new(EXPORT_FAILED)),
    };
    if !meta.is_file() || is_link(&meta) {
        return Err(AppError::new(STORAGE_UNSUPPORTED));
    }
    let mut file = fs::File::open(path).map_err(|_| AppError::new(EXPORT_FAILED))?;
    let mut hash = Sha256::new();
    let mut buf = [0; 64 * 1024];
    let mut bytes = 0_u64;
    loop {
        cancel.check()?;
        let n = file
            .read(&mut buf)
            .map_err(|_| AppError::new(EXPORT_FAILED))?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        if bytes > MAX_TOTAL + 4 * MAX_MANIFEST {
            return Err(AppError::new(TOO_LARGE));
        }
        hash.update(&buf[..n]);
    }
    Ok(Some(Fingerprint {
        bytes,
        created: meta.created().map_err(|_| AppError::new(EXPORT_FAILED))?,
        modified: meta.modified().map_err(|_| AppError::new(EXPORT_FAILED))?,
        hash: format!("{:x}", hash.finalize()),
    }))
}

pub(super) struct Target {
    path: PathBuf,
    initial: Option<Fingerprint>,
}

impl Target {
    pub fn capture(
        path: &Path,
        state_root: &Path,
        scratch: &Path,
        cancel: &Cancellation,
    ) -> Result<Self, AppError> {
        Self::capture_with_suffix(path, state_root, scratch, cancel, ".tenon-backup.zip")
    }

    pub fn capture_diagnostics(
        path: &Path,
        state_root: &Path,
        scratch: &Path,
        cancel: &Cancellation,
    ) -> Result<Self, AppError> {
        Self::capture_with_suffix(path, state_root, scratch, cancel, ".tenon-diagnostics.zip")
    }

    fn capture_with_suffix(
        path: &Path,
        state_root: &Path,
        scratch: &Path,
        cancel: &Cancellation,
        suffix: &str,
    ) -> Result<Self, AppError> {
        check_layout(state_root, scratch)?;
        let path = regular_path(path, true)?;
        let state_root =
            fs::canonicalize(state_root).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
        let scratch = fs::canonicalize(scratch).map_err(|_| AppError::new(STORAGE_UNSUPPORTED))?;
        if path.starts_with(&state_root)
            || path.starts_with(&scratch)
            || !path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(suffix))
        {
            return Err(AppError::new(STORAGE_UNSUPPORTED));
        }
        same_volume(
            &state_root,
            path.parent()
                .ok_or_else(|| AppError::new(STORAGE_UNSUPPORTED))?,
        )?;
        Ok(Self {
            initial: fingerprint(&path, cancel)?,
            path,
        })
    }

    pub fn commit(
        self,
        archive: tempfile::NamedTempFile,
        cancel: &Cancellation,
    ) -> Result<(), AppError> {
        regular_path(&self.path, true)?;
        if fingerprint(&self.path, cancel)? != self.initial {
            return Err(AppError::new(EXPORT_FAILED));
        }
        cancel.commit()?;
        if self.initial.is_some() {
            archive.persist(&self.path)
        } else {
            archive.persist_noclobber(&self.path)
        }
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
        Ok(())
    }
}
