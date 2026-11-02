//! 只打包宿主构造的白名单文本；不收集任何应用数据。
use super::{Cancellation, EXPORT_FAILED, ManifestEntry, TOO_LARGE, Target};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Cursor, Read, Write},
    path::Path,
};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

const MAX_ARCHIVE: u64 = 1024 * 1024;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format_version: u32,
    // 与备份一致：manifest 不自哈希；整个 ZIP 的 FileArtifact 哈希覆盖 manifest。
    entries: [ManifestEntry; 1],
}

fn manifest(text: &[u8]) -> Manifest {
    Manifest {
        format_version: 1,
        entries: [ManifestEntry {
            path: "diagnostics.txt".into(),
            bytes: text.len() as u64,
            sha256: format!("{:x}", Sha256::digest(text)),
        }],
    }
}

/// 输入只能是宿主白名单渲染结果，所有路径由宿主及专用文件令牌提供。
pub fn export_diagnostics(
    text: &[u8],
    state_root: &Path,
    scratch: &Path,
    destination: &Path,
) -> Result<(u64, String), AppError> {
    if text.len() as u64 > MAX_ARCHIVE {
        return Err(AppError::new(TOO_LARGE));
    }
    let cancel = Cancellation::default();
    let target = Target::capture_diagnostics(destination, state_root, scratch, &cancel)?;
    let mut archive =
        tempfile::NamedTempFile::new_in(scratch).map_err(|_| AppError::new(EXPORT_FAILED))?;
    let json = serde_json::to_vec(&manifest(text)).map_err(|_| AppError::new(EXPORT_FAILED))?;
    let mut zip = ZipWriter::new(archive.as_file_mut());
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o600);
    for (name, content) in [
        ("manifest.json", json.as_slice()),
        ("diagnostics.txt", text),
    ] {
        zip.start_file(name, options)
            .map_err(|_| AppError::new(EXPORT_FAILED))?;
        zip.write_all(content)
            .map_err(|_| AppError::new(EXPORT_FAILED))?;
    }
    zip.finish().map_err(|_| AppError::new(EXPORT_FAILED))?;
    archive
        .as_file()
        .sync_all()
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    let artifact = validate(archive.path(), text)?;
    target.commit(archive, &cancel)?;
    Ok(artifact)
}

fn validate(path: &Path, text: &[u8]) -> Result<(u64, String), AppError> {
    let mut raw = Vec::new();
    File::open(path)
        .map_err(|_| AppError::new(EXPORT_FAILED))?
        .take(MAX_ARCHIVE + 1)
        .read_to_end(&mut raw)
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    if raw.len() as u64 > MAX_ARCHIVE {
        return Err(AppError::new(TOO_LARGE));
    }
    let mut zip = ZipArchive::new(Cursor::new(&raw)).map_err(|_| AppError::new(EXPORT_FAILED))?;
    if zip.len() != 2 {
        return Err(AppError::new(EXPORT_FAILED));
    }
    for (index, name) in ["manifest.json", "diagnostics.txt"].into_iter().enumerate() {
        let entry = zip
            .by_index(index)
            .map_err(|_| AppError::new(EXPORT_FAILED))?;
        if entry.name() != name
            || entry.compression() != CompressionMethod::Stored
            || entry.size() > MAX_ARCHIVE
            || entry.is_dir()
            || entry.is_symlink()
        {
            return Err(AppError::new(EXPORT_FAILED));
        }
        let mut bytes = Vec::new();
        entry
            .take(MAX_ARCHIVE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| AppError::new(EXPORT_FAILED))?;
        if index == 0 {
            let actual: Manifest =
                serde_json::from_slice(&bytes).map_err(|_| AppError::new(EXPORT_FAILED))?;
            if actual != manifest(text) {
                return Err(AppError::new(EXPORT_FAILED));
            }
        } else if bytes != text {
            return Err(AppError::new(EXPORT_FAILED));
        }
    }
    Ok((raw.len() as u64, format!("{:x}", Sha256::digest(&raw))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const SAMPLE: &str = "Diagnostics v1\nDatabase: SQLite\nCache: local\nStatus: ready";

    #[test]
    fn diagnostic_zip_contains_only_supplied_text() {
        let root = super::super::tests::workspace();
        let state = root.path().join("state");
        fs::create_dir(&state).unwrap();
        for name in ["logs", "config.json", "credentials", "app.db"] {
            fs::write(state.join(name), "private-diagnostic-sentinel").unwrap();
        }
        let scratch = root.path().join("stage");
        let destination = root.path().join("tenon.tenon-diagnostics.zip");
        let artifact =
            export_diagnostics(SAMPLE.as_bytes(), &state, &scratch, &destination).unwrap();
        let raw = fs::read(&destination).unwrap();
        assert_eq!(
            artifact,
            (raw.len() as u64, format!("{:x}", Sha256::digest(&raw)))
        );
        assert!(raw.len() <= MAX_ARCHIVE as usize);
        assert!(!String::from_utf8_lossy(&raw).contains("private-diagnostic-sentinel"));
        let mut zip = ZipArchive::new(Cursor::new(raw)).unwrap();
        assert_eq!(zip.len(), 2);
        for name in ["manifest.json", "diagnostics.txt"] {
            assert_eq!(
                zip.by_name(name).unwrap().compression(),
                CompressionMethod::Stored
            );
        }
        let mut json = String::new();
        zip.by_name("manifest.json")
            .unwrap()
            .read_to_string(&mut json)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&json).unwrap(),
            serde_json::json!({
                "formatVersion": 1,
                "entries": [{
                    "path": "diagnostics.txt",
                    "bytes": SAMPLE.len(),
                    "sha256": format!("{:x}", Sha256::digest(SAMPLE.as_bytes())),
                }],
            })
        );
        let mut text = Vec::new();
        zip.by_name("diagnostics.txt")
            .unwrap()
            .read_to_end(&mut text)
            .unwrap();
        assert_eq!(text, SAMPLE.as_bytes());
        assert_eq!(fs::read_dir(&scratch).unwrap().count(), 0);
    }

    #[test]
    fn actual_archive_rejects_extra_entries_compression_and_tampering() {
        let root = super::super::tests::workspace();
        let path = root.path().join("invalid.zip");
        for case in [
            "extra",
            "path",
            "compressed",
            "hash",
            "text",
            "field",
            "version",
        ] {
            let mut zip = ZipWriter::new(File::create(&path).unwrap());
            let options =
                SimpleFileOptions::default().compression_method(if case == "compressed" {
                    CompressionMethod::Deflated
                } else {
                    CompressionMethod::Stored
                });
            let mut json = serde_json::to_value(manifest(SAMPLE.as_bytes())).unwrap();
            match case {
                "hash" => json["entries"][0]["sha256"] = "0".repeat(64).into(),
                "field" => json["source"] = "forbidden".into(),
                "version" => json["formatVersion"] = 2.into(),
                _ => {}
            }
            zip.start_file("manifest.json", options).unwrap();
            zip.write_all(&serde_json::to_vec(&json).unwrap()).unwrap();
            zip.start_file(
                if case == "path" {
                    "diag.txt"
                } else {
                    "diagnostics.txt"
                },
                options,
            )
            .unwrap();
            zip.write_all(if case == "text" {
                b"changed"
            } else {
                SAMPLE.as_bytes()
            })
            .unwrap();
            if case == "extra" {
                zip.start_file("logs.txt", options).unwrap();
            }
            zip.finish().unwrap();
            assert!(validate(&path, SAMPLE.as_bytes()).is_err(), "{case}");
        }
    }

    #[test]
    fn total_limit_includes_zip_overhead_and_preserves_old_target() {
        let root = super::super::tests::workspace();
        let state = root.path().join("state");
        fs::create_dir(&state).unwrap();
        let scratch = root.path().join("stage");
        let destination = root.path().join("old.tenon-diagnostics.zip");
        fs::write(&destination, b"old archive").unwrap();
        for size in [MAX_ARCHIVE as usize, MAX_ARCHIVE as usize + 1] {
            let error =
                export_diagnostics(&vec![b'x'; size], &state, &scratch, &destination).unwrap_err();
            assert_eq!(error.code(), TOO_LARGE);
            assert_eq!(fs::read(&destination).unwrap(), b"old archive");
            assert_eq!(fs::read_dir(&scratch).unwrap().count(), 0);
        }
    }
}
