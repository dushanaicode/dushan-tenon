// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Dushan Tenon's bounded, explicit-scratch Unix installation path.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Component, Path, PathBuf},
};

use rustix::fs::{CWD, RenameFlags, renameat_with};
use serde::Serialize;

use crate::{Error, MAX_DOWNLOAD_BYTES, OnBeforeExit, Result};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
struct Identity {
    device: u64,
    inode: u64,
    bytes: u64,
    modified: i64,
    modified_ns: i64,
    mode: u32,
}

fn identity(path: &Path) -> Result<Identity> {
    let m = fs::symlink_metadata(path)?;
    if m.file_type().is_symlink() || !(m.is_file() || m.is_dir()) {
        return Err(Error::InvalidUpdaterFormat);
    }
    Ok(Identity {
        device: m.dev(),
        inode: m.ino(),
        bytes: m.len(),
        modified: m.mtime(),
        modified_ns: m.mtime_nsec(),
        mode: m.mode(),
    })
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Prepared,
    Installed,
    RolledBack,
}

#[derive(Serialize)]
struct Journal<'a> {
    schema: u8,
    phase: Phase,
    target: &'a Path,
    exchange_path: &'a Path,
    original: Identity,
    replacement: Identity,
}

struct Prepared {
    directory: PathBuf,
    target: PathBuf,
    replacement: PathBuf,
    original: Identity,
    next: Identity,
}

fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

impl Prepared {
    fn journal(&self, phase: Phase) -> Result<()> {
        let data = serde_json::to_vec(&Journal {
            schema: 1,
            phase,
            target: &self.target,
            exchange_path: &self.replacement,
            original: self.original,
            replacement: self.next,
        })?;
        let mut stage = tempfile::NamedTempFile::new_in(&self.directory)?;
        stage.write_all(&data)?;
        stage.as_file().sync_all()?;
        stage
            .persist(self.directory.join("install-journal.json"))
            .map_err(|e| e.error)?;
        sync_directory(&self.directory)
    }

    fn unchanged(&self) -> Result<()> {
        if identity(&self.target)? != self.original || identity(&self.replacement)? != self.next {
            return Err(Error::InvalidUpdaterFormat);
        }
        Ok(())
    }

    fn exchange(&self) -> Result<()> {
        renameat_with(
            CWD,
            &self.replacement,
            CWD,
            &self.target,
            RenameFlags::EXCHANGE,
        )
        .map_err(io::Error::from)?;
        Ok(())
    }

    fn sync_parents(&self) -> Result<()> {
        sync_directory(self.target.parent().ok_or(Error::InvalidUpdaterFormat)?)?;
        sync_directory(
            self.replacement
                .parent()
                .ok_or(Error::InvalidUpdaterFormat)?,
        )
    }
}

/// The journal callback is injected only by isolated fault tests. There is no
/// delete/move-away fallback: a filesystem without atomic exchange is rejected.
fn commit(
    prepared: &Prepared,
    before_exit: &OnBeforeExit,
    journal: impl Fn(Phase) -> Result<()>,
) -> Result<()> {
    prepared.unchanged()?;
    journal(Phase::Prepared)?;
    prepared.sync_parents()?;
    before_exit();
    prepared.unchanged()?;
    prepared.exchange()?;
    if let Err(error) = prepared
        .sync_parents()
        .and_then(|_| journal(Phase::Installed))
    {
        // Exchange again restores the original at its path without an absent-target window.
        if identity(&prepared.target)? != prepared.next
            || identity(&prepared.replacement)? != prepared.original
        {
            return Err(Error::InvalidUpdaterFormat);
        }
        prepared.exchange()?;
        prepared.sync_parents()?;
        journal(Phase::RolledBack)?;
        return Err(error);
    }
    Ok(())
}

fn scratch_directory(root: Option<&Path>, target: &Path) -> Result<PathBuf> {
    let root = root.ok_or(Error::TempDirNotFound)?;
    if !root.is_absolute() || root.canonicalize()? != root || target.canonicalize()? != target {
        return Err(Error::TempDirNotFound);
    }
    // The host supplies the operation directory beneath its explicit Temp root.
    // Native app launchers do not provide a meaningful cwd; validate the entire injected path.
    let mut directory = PathBuf::from("/");
    for component in root.components() {
        if matches!(component, Component::RootDir) {
            continue;
        }
        let Component::Normal(name) = component else {
            return Err(Error::TempDirNotFound);
        };
        directory.push(name);
        if !fs::symlink_metadata(&directory)?.is_dir() {
            return Err(Error::TempDirNotFound);
        }
    }
    if fs::metadata(root)?.dev() != identity(target)?.device {
        return Err(Error::TempDirNotOnSameMountPoint);
    }
    Ok(tempfile::Builder::new()
        .prefix("install-")
        .tempdir_in(root)?
        .keep())
}

pub(crate) fn install(
    bytes: &[u8],
    target: &Path,
    root: Option<&Path>,
    app_name: &str,
    before_exit: Option<&OnBeforeExit>,
) -> Result<()> {
    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err(Error::DownloadTooLarge);
    }
    let before_exit = before_exit.ok_or(Error::InvalidUpdaterFormat)?;
    let original = identity(target)?;
    let directory = scratch_directory(root, target)?;
    let replacement = prepare(bytes, target, &directory, app_name)?;
    let next = identity(&replacement)?;
    if original.device != next.device {
        return Err(Error::TempDirNotOnSameMountPoint);
    }
    let prepared = Prepared {
        directory,
        target: target.into(),
        replacement,
        original,
        next,
    };
    commit(&prepared, before_exit, |phase| prepared.journal(phase))
}

#[cfg(target_os = "linux")]
fn appimage_header(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 64
        || &bytes[..4] != b"\x7fELF"
        || bytes[4..7] != [2, 1, 1]
        || &bytes[8..11] != b"AI\x02"
    {
        return Err(Error::InvalidUpdaterFormat);
    }
    let machine = u16::from_le_bytes([bytes[18], bytes[19]]);
    if !matches!(
        (std::env::consts::ARCH, machine),
        ("x86_64", 62) | ("aarch64", 183)
    ) {
        return Err(Error::InvalidUpdaterFormat);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn prepare(bytes: &[u8], target: &Path, directory: &Path, _app_name: &str) -> Result<PathBuf> {
    use std::io::Read;
    // Both installed and incoming artifacts must be AppImages; a renamed raw ELF
    // or a package-manager installation is not a target for this installer.
    if !fs::symlink_metadata(target)?.is_file() {
        return Err(Error::InvalidUpdaterFormat);
    }
    appimage_header(bytes)?;
    let mut current = [0; 64];
    File::open(target)?.read_exact(&mut current)?;
    appimage_header(&current)?;
    let permissions = fs::metadata(target)?.permissions().mode() & 0o777;
    if permissions & 0o111 == 0 {
        return Err(Error::InvalidUpdaterFormat);
    }
    let replacement = directory.join("exchange.AppImage");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&replacement)?;
    file.write_all(bytes)?;
    file.set_permissions(fs::Permissions::from_mode(permissions))?;
    file.sync_all()?;
    Ok(replacement)
}

#[cfg(target_os = "macos")]
mod archive {
    use super::*;
    use flate2::bufread::GzDecoder;
    use std::{
        collections::HashSet,
        io::{Cursor, Read, Take},
    };

    const MAX_ENTRIES: usize = 20_000;
    const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
    const MAX_META_BYTES: u64 = 64 * 1024;
    const MAX_EXPANDED_BYTES: u64 = 1024 * 1024 * 1024;
    type Reader<'a> = Take<GzDecoder<Cursor<&'a [u8]>>>;

    fn reader(bytes: &[u8]) -> Reader<'_> {
        GzDecoder::new(Cursor::new(bytes)).take(MAX_EXPANDED_BYTES + 1)
    }

    fn finish(mut reader: Reader<'_>, compressed: usize) -> Result<()> {
        let mut buf = [0; 8192];
        loop {
            let count = reader.read(&mut buf)?;
            if count == 0 {
                break;
            }
            if buf[..count].iter().any(|b| *b != 0) {
                return Err(Error::InvalidUpdaterFormat);
            }
        }
        if reader.limit() == 0 {
            return Err(Error::DownloadTooLarge);
        }
        if reader.into_inner().into_inner().position() != compressed as u64 {
            return Err(Error::InvalidUpdaterFormat);
        }
        Ok(())
    }

    fn preflight(bytes: &[u8]) -> Result<()> {
        let mut archive = tar::Archive::new(reader(bytes));
        for (index, entry) in archive.entries()?.raw(true).enumerate() {
            if index >= MAX_ENTRIES {
                return Err(Error::DownloadTooLarge);
            }
            let mut entry = entry?;
            let kind = entry.header().entry_type();
            let limit = if kind.is_file() {
                MAX_FILE_BYTES
            } else if kind.is_gnu_longname() {
                MAX_META_BYTES
            } else if kind.is_dir() {
                0
            } else {
                return Err(Error::InvalidUpdaterFormat);
            };
            if entry.size() > limit {
                return Err(Error::DownloadTooLarge);
            }
            let expected = entry.size();
            if io::copy(&mut entry, &mut io::sink())? != expected {
                return Err(Error::InvalidUpdaterFormat);
            }
        }
        finish(archive.into_inner(), bytes.len())
    }

    pub(super) fn extract(
        bytes: &[u8],
        bundle: &Path,
        directory: &Path,
        app_name: &str,
    ) -> Result<PathBuf> {
        preflight(bytes)?;
        let bundle_name = bundle.file_name().ok_or(Error::InvalidUpdaterFormat)?;
        if bundle.extension() != Some("app".as_ref())
            || !fs::symlink_metadata(bundle)?.is_dir()
            || Path::new(app_name).components().count() != 1
            || !matches!(
                Path::new(app_name).components().next(),
                Some(Component::Normal(_))
            )
        {
            return Err(Error::InvalidUpdaterFormat);
        }
        let mut archive = tar::Archive::new(reader(bytes));
        let mut paths = HashSet::new();
        let mut resolved = HashSet::new();
        let mut dirs = HashSet::new();
        for (index, entry) in archive.entries()?.enumerate() {
            if index >= MAX_ENTRIES {
                return Err(Error::DownloadTooLarge);
            }
            let mut entry = entry?;
            let path = entry.path()?.into_owned();
            let text = path.to_str().ok_or(Error::InvalidUpdaterFormat)?;
            let mut components = path.components();
            if text.len() > 4096
                || text.contains('\\')
                || components.next() != Some(Component::Normal(bundle_name))
                || components.any(|c| !matches!(c, Component::Normal(_)))
                || !paths.insert(
                    path.components()
                        .collect::<PathBuf>()
                        .to_string_lossy()
                        .to_lowercase(),
                )
            {
                return Err(Error::InvalidUpdaterFormat);
            }
            let destination = directory.join(&path);
            let kind = entry.header().entry_type();
            if kind.is_dir() {
                fs::create_dir_all(&destination)?;
                for dir in destination
                    .ancestors()
                    .take_while(|dir| dir.starts_with(directory))
                {
                    dirs.insert(dir.to_path_buf());
                }
            } else if kind.is_file() {
                let size = entry.size();
                if size > MAX_FILE_BYTES {
                    return Err(Error::DownloadTooLarge);
                }
                let parent = destination.parent().ok_or(Error::InvalidUpdaterFormat)?;
                fs::create_dir_all(parent)?;
                for dir in parent
                    .ancestors()
                    .take_while(|dir| dir.starts_with(directory))
                {
                    dirs.insert(dir.to_path_buf());
                }
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&destination)?;
                if io::copy(&mut entry, &mut file)? != size {
                    return Err(Error::InvalidUpdaterFormat);
                }
                file.set_permissions(fs::Permissions::from_mode(entry.header().mode()? & 0o777))?;
                file.sync_all()?;
            } else {
                return Err(Error::InvalidUpdaterFormat);
            }
            if !resolved.insert(destination.canonicalize()?) {
                return Err(Error::InvalidUpdaterFormat);
            }
        }
        finish(archive.into_inner(), bytes.len())?;
        let replacement = directory.join(bundle_name);
        let binary = replacement.join("Contents/MacOS").join(app_name);
        if !replacement.join("Contents/Info.plist").is_file()
            || fs::symlink_metadata(&binary)?.permissions().mode() & 0o111 == 0
        {
            return Err(Error::InvalidUpdaterFormat);
        }
        let mut magic = [0; 4];
        File::open(binary)?.read_exact(&mut magic)?;
        if !matches!(
            magic,
            [0xcf, 0xfa, 0xed, 0xfe]
                | [0xfe, 0xed, 0xfa, 0xcf]
                | [0xca, 0xfe, 0xba, 0xbe]
                | [0xbe, 0xba, 0xfe, 0xca]
                | [0xca, 0xfe, 0xba, 0xbf]
                | [0xbf, 0xba, 0xfe, 0xca]
        ) {
            return Err(Error::InvalidUpdaterFormat);
        }
        for dir in dirs {
            sync_directory(&dir)?;
        }
        sync_directory(&replacement)?;
        Ok(replacement)
    }
}

#[cfg(target_os = "macos")]
fn prepare(bytes: &[u8], target: &Path, directory: &Path, app_name: &str) -> Result<PathBuf> {
    archive::extract(bytes, target, directory, app_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    fn transaction() -> (tempfile::TempDir, Prepared) {
        let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let target = root.path().join("target");
        let replacement = root.path().join("replacement");
        fs::write(&target, b"old").unwrap();
        fs::write(&replacement, b"new").unwrap();
        let transaction = Prepared {
            directory: root.path().into(),
            original: identity(&target).unwrap(),
            next: identity(&replacement).unwrap(),
            target,
            replacement,
        };
        (root, transaction)
    }

    #[test]
    fn atomic_exchange_runs_shutdown_first_and_keeps_original() {
        let (_root, prepared) = transaction();
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        let target = prepared.target.clone();
        let shutdown: OnBeforeExit = Arc::new(move || {
            assert_eq!(fs::read(&target).unwrap(), b"old");
            flag.store(true, Ordering::SeqCst);
        });
        commit(&prepared, &shutdown, |phase| prepared.journal(phase)).unwrap();
        assert!(closed.load(Ordering::SeqCst));
        assert_eq!(fs::read(&prepared.target).unwrap(), b"new");
        assert_eq!(fs::read(&prepared.replacement).unwrap(), b"old");
        let journal: serde_json::Value = serde_json::from_slice(
            &fs::read(prepared.directory.join("install-journal.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(journal["phase"], "installed");
    }

    #[test]
    fn journal_failure_after_exchange_rolls_back_without_deleting_either_file() {
        let (_root, prepared) = transaction();
        let shutdown: OnBeforeExit = Arc::new(|| {});
        let result = commit(&prepared, &shutdown, |phase| {
            if matches!(phase, Phase::Installed) {
                return Err(io::Error::other("injected disk failure").into());
            }
            prepared.journal(phase)
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&prepared.target).unwrap(), b"old");
        assert_eq!(fs::read(&prepared.replacement).unwrap(), b"new");
        let journal: serde_json::Value = serde_json::from_slice(
            &fs::read(prepared.directory.join("install-journal.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(journal["phase"], "rolled_back");
    }

    #[test]
    fn changed_target_after_shutdown_is_never_exchanged() {
        let (_root, prepared) = transaction();
        let target = prepared.target.clone();
        let shutdown: OnBeforeExit =
            Arc::new(move || fs::write(&target, b"changed elsewhere").unwrap());
        assert!(commit(&prepared, &shutdown, |phase| prepared.journal(phase)).is_err());
        assert_eq!(fs::read(&prepared.target).unwrap(), b"changed elsewhere");
        assert_eq!(fs::read(&prepared.replacement).unwrap(), b"new");
    }

    #[test]
    fn nonempty_directory_exchange_rolls_back_after_record_failure() {
        let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let target = root.path().join("Current.app");
        let replacement = root.path().join("Next.app");
        fs::create_dir(&target).unwrap();
        fs::create_dir(&replacement).unwrap();
        fs::write(target.join("binary"), b"old").unwrap();
        fs::write(replacement.join("binary"), b"new").unwrap();
        let prepared = Prepared {
            directory: root.path().into(),
            original: identity(&target).unwrap(),
            next: identity(&replacement).unwrap(),
            target,
            replacement,
        };
        let hook: OnBeforeExit = Arc::new(|| {});
        assert!(
            commit(&prepared, &hook, |phase| {
                if matches!(phase, Phase::Installed) {
                    return Err(io::Error::other("injected disk failure").into());
                }
                prepared.journal(phase)
            })
            .is_err()
        );
        assert_eq!(fs::read(prepared.target.join("binary")).unwrap(), b"old");
        assert_eq!(
            fs::read(prepared.replacement.join("binary")).unwrap(),
            b"new"
        );
    }

    #[test]
    fn scratch_and_link_validation_happen_before_shutdown() {
        let (root, prepared) = transaction();
        assert!(scratch_directory(None, &prepared.target).is_err());
        assert!(scratch_directory(Some(Path::new("relative")), &prepared.target).is_err());
        let linked = root.path().join("linked");
        std::os::unix::fs::symlink(&prepared.target, &linked).unwrap();
        assert!(identity(&linked).is_err());
        assert_eq!(fs::read(&prepared.target).unwrap(), b"old");
    }

    #[test]
    fn injected_scratch_is_independent_of_cwd_and_rejects_directory_links() {
        let (root, prepared) = transaction();
        let state = root.path().join("native-state");
        let injected = state.join("Temp/updates/operation");
        fs::create_dir_all(&injected).unwrap();
        let injected = injected.canonicalize().unwrap();
        let target = prepared.target.canonicalize().unwrap();
        let install = scratch_directory(Some(&injected), &target).unwrap();
        assert_eq!(install.parent(), Some(injected.as_path()));
        let linked = root.path().join("linked-state");
        std::os::unix::fs::symlink(&state, &linked).unwrap();
        assert!(scratch_directory(Some(&linked.join("Temp/updates/operation")), &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn bare_appimage_is_checked_staged_and_exchanged_without_execution() {
        let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let target = root.path().join("example.AppImage");
        let mut bytes = vec![0; 64];
        bytes[..7].copy_from_slice(b"\x7fELF\x02\x01\x01");
        bytes[8..11].copy_from_slice(b"AI\x02");
        bytes[18..20].copy_from_slice(
            &(if cfg!(target_arch = "aarch64") {
                183u16
            } else {
                62u16
            })
            .to_le_bytes(),
        );
        let mut original = bytes.clone();
        original.extend_from_slice(b"old");
        fs::write(&target, original).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        let target = target.canonicalize().unwrap();
        let scratch = root.path().canonicalize().unwrap();
        let called = Arc::new(AtomicBool::new(false));
        let flag = called.clone();
        let hook: OnBeforeExit = Arc::new(move || {
            flag.store(true, Ordering::SeqCst);
        });
        assert!(
            install(
                b"not-an-appimage",
                &target,
                Some(&scratch),
                "example",
                Some(&hook)
            )
            .is_err()
        );
        assert!(!called.load(Ordering::SeqCst));
        install(&bytes, &target, Some(&scratch), "example", Some(&hook)).unwrap();
        assert!(called.load(Ordering::SeqCst));
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[cfg(target_os = "macos")]
    fn mac_bundle() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let target = root.path().join("Example.app");
        fs::create_dir_all(target.join("Contents/MacOS")).unwrap();
        fs::write(target.join("Contents/MacOS/fixture"), b"old").unwrap();
        (root, target)
    }

    #[cfg(target_os = "macos")]
    fn bundle_bytes(extra: Option<(&str, tar::EntryType)>) -> Vec<u8> {
        let gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut archive = tar::Builder::new(gzip);
        for (name, bytes, mode) in [
            (
                "Example.app/Contents/Info.plist",
                b"fixture metadata".as_slice(),
                0o644,
            ),
            (
                "Example.app/Contents/MacOS/fixture",
                b"\xcf\xfa\xed\xfenew".as_slice(),
                0o755,
            ),
        ] {
            let mut h = tar::Header::new_gnu();
            h.set_size(bytes.len() as u64);
            h.set_mode(mode);
            h.set_cksum();
            archive.append_data(&mut h, name, bytes).unwrap();
        }
        if let Some((name, kind)) = extra {
            let mut h = tar::Header::new_gnu();
            h.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
            h.set_entry_type(kind);
            h.set_size(0);
            h.set_mode(0o644);
            h.set_cksum();
            archive.append(&h, io::empty()).unwrap();
        }
        archive.into_inner().unwrap().finish().unwrap()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_bundle_rejects_traversal_links_duplicates_and_preserves_current_app() {
        let (root, target) = mac_bundle();
        let scratch = root.path().canonicalize().unwrap();
        let target = target.canonicalize().unwrap();
        let hook: OnBeforeExit = Arc::new(|| panic!("invalid package must not shut down"));
        for entry in [
            ("../escape", tar::EntryType::Regular),
            ("Example.app/Contents/link", tar::EntryType::Symlink),
            ("Example.app/Contents/Info.plist", tar::EntryType::Regular),
            ("Example.app/Contents/info.PLIST", tar::EntryType::Regular),
        ] {
            assert!(
                install(
                    &bundle_bytes(Some(entry)),
                    &target,
                    Some(&scratch),
                    "fixture",
                    Some(&hook)
                )
                .is_err()
            );
            assert_eq!(
                fs::read(target.join("Contents/MacOS/fixture")).unwrap(),
                b"old"
            );
        }
        assert!(!root.path().join("escape").exists());
        let hook: OnBeforeExit = Arc::new(|| {});
        install(
            &bundle_bytes(None),
            &target,
            Some(&scratch),
            "fixture",
            Some(&hook),
        )
        .unwrap();
        assert_eq!(
            fs::read(target.join("Contents/MacOS/fixture")).unwrap(),
            b"\xcf\xfa\xed\xfenew"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn archive_metadata_budget_is_checked_before_allocating_long_names() {
        let (root, target) = mac_bundle();
        let mut h = tar::Header::new_gnu();
        h.set_path("long-name").unwrap();
        h.set_entry_type(tar::EntryType::GNULongName);
        h.set_size(65537);
        h.set_mode(0o644);
        h.set_cksum();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gzip.write_all(h.as_bytes()).unwrap();
        gzip.write_all(&[0; 1024]).unwrap();
        let bytes = gzip.finish().unwrap();
        let hook: OnBeforeExit = Arc::new(|| panic!("invalid package must not shut down"));
        assert!(matches!(
            install(
                &bytes,
                &target.canonicalize().unwrap(),
                Some(&root.path().canonicalize().unwrap()),
                "fixture",
                Some(&hook)
            ),
            Err(Error::DownloadTooLarge)
        ));
    }
}
