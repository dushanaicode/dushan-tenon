use serde::{Deserialize, Serialize};

use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestEntry {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationEntry {
    pub module: String,
    pub version: u32,
    pub name: String,
    pub checksum: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupManifest {
    pub format: String,
    pub format_version: u32,
    pub product_id: String,
    pub app_version: String,
    pub created_at: String,
    pub source_instance_id: String,
    pub database_kind: String,
    pub migration_records: Vec<MigrationEntry>,
    pub entries: Vec<ManifestEntry>,
    pub total_bytes: u64,
    pub excluded: Vec<String>,
}

pub(super) const EXCLUDED: &[&str] = &[
    "secrets",
    "environment",
    "cache",
    "otp",
    "webview",
    "logs",
    "upgradeBackups",
    "workbench",
    "windowState",
    "autostart",
    "temporaryFiles",
    "streams",
];

pub(super) fn entry_limit(path: &str) -> Result<u64, AppError> {
    match path {
        "manifest.json" => Ok(MAX_MANIFEST),
        "database/app.db" => Ok(MAX_DATABASE),
        "config.json" => Ok(MAX_MANIFEST),
        _ => {
            let parts: Vec<_> = path.split('/').collect();
            if parts.len() != 4
                || parts[0] != "files"
                || parts[1].len() != 4
                || !parts[1].bytes().all(|b| b.is_ascii_digit())
                || parts[2].len() != 2
                || !matches!(parts[2].parse::<u8>(), Ok(1..=12))
                || parts[3].parse::<crate::id::Id>().is_err()
            {
                return Err(AppError::new(INVALID_ARCHIVE));
            }
            Ok(MAX_FILE)
        }
    }
}

impl BackupManifest {
    pub(super) fn validate(&self, product: &str) -> Result<(), AppError> {
        use std::collections::BTreeSet;
        if self.format != "tenon-backup"
            || self.format_version != 1
            || self.product_id != product
            || self.database_kind != "sqlite"
            || self.excluded != EXCLUDED
            || self.source_instance_id.parse::<crate::id::Id>().is_err()
            || self.created_at.parse::<jiff::Timestamp>().is_err()
        {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        if self.entries.len() + 1 > MAX_ENTRIES {
            return Err(AppError::new(TOO_LARGE));
        }
        let mut names = BTreeSet::new();
        let mut total = 0_u64;
        for entry in &self.entries {
            if entry.path == "manifest.json"
                || !names.insert(&entry.path)
                || entry.sha256.len() != 64
                || !entry
                    .sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(AppError::new(INVALID_ARCHIVE));
            }
            if entry.bytes > entry_limit(&entry.path)? {
                return Err(AppError::new(TOO_LARGE));
            }
            total = total
                .checked_add(entry.bytes)
                .ok_or_else(|| AppError::new(TOO_LARGE))?;
        }
        if total > MAX_TOTAL {
            return Err(AppError::new(TOO_LARGE));
        }
        if total != self.total_bytes
            || !names.contains(&"database/app.db".to_owned())
            || !names.contains(&"config.json".to_owned())
        {
            return Err(AppError::new(INVALID_ARCHIVE));
        }
        Ok(())
    }
}
