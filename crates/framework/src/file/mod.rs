//! 本机文件：磁盘由 FileStore 管理，业务表只保存文件 ID。
mod sniff;
mod store;
pub use store::FileStore;

#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

use crate::{db::PageRequest, error::ErrorCode, id::Id, time::Timestamp};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const DEFAULT_MAX_MIB: u64 = 20;

pub const KNOWN_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "pdf", "xlsx", "txt", "md", "csv", "json",
];

#[derive(Clone, Copy, Debug)]
pub struct FilePurposeDeclaration {
    pub code: &'static str,
    pub extensions: &'static [&'static str],
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileListInput {
    #[serde(flatten)]
    pub pagination: PageRequest,
    #[ts(optional)]
    pub purpose: Option<String>,
    #[ts(optional)]
    pub keyword: Option<String>,
}

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct FileRecord {
    pub id: Id,
    pub purpose: String,
    pub original_name: String,
    pub extension: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub stored_path: String,
    pub created_at: Timestamp,
    pub created_by: Id,
    pub row_version: i64,
    #[sqlx(skip)]
    pub missing: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FilePreview {
    Image {
        mime: String,
        #[serde(rename = "dataUrl")]
        data_url: String,
    },
    Text {
        text: String,
        truncated: bool,
    },
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileTextPageInput {
    pub id: Id,
    #[ts(type = "number")]
    pub offset: u64,
    #[serde(with = "Option")]
    #[ts(as = "Option<String>")]
    pub fingerprint: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileTextPage {
    pub text: String,
    #[ts(type = "number")]
    pub offset: u64,
    #[ts(type = "number | null")]
    pub next_offset: Option<u64>,
    #[ts(type = "number")]
    pub total_bytes: u64,
    pub fingerprint: String,
}

#[derive(Debug, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimReport {
    pub orphan_files: u32,
    #[ts(type = "number")]
    pub orphan_bytes: u64,
    pub stale_tmp: u32,
    pub missing_rows: u32,
    pub failed: u32,
}

pub const TYPE_NOT_ALLOWED: ErrorCode = ErrorCode::new("app.file.type_not_allowed");
pub const TOO_LARGE: ErrorCode = ErrorCode::new("app.file.too_large");
pub const CONTENT_MISMATCH: ErrorCode = ErrorCode::new("app.file.content_mismatch");
pub const PREVIEW_TOO_LARGE: ErrorCode = ErrorCode::new("app.file.preview_too_large");
pub const PREVIEW_UNSUPPORTED: ErrorCode = ErrorCode::new("app.file.preview_unsupported");
pub const MISSING: ErrorCode = ErrorCode::new("app.file.missing");
