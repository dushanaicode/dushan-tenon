use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use tenon_framework::file::{
    FileListInput, FilePreview, FileTextPage, FileTextPageInput, ReclaimReport,
};
use tenon_framework::{
    actor::ExecutionContext,
    db::Page,
    error::AppError,
    file::{FileRecord, FileStore},
    id::Id,
    time::Timestamp,
};

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FileId {
    pub id: Id,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileDelete {
    pub id: Id,
    #[ts(type = "number")]
    pub row_version: i64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileSummary {
    pub id: Id,
    pub purpose: String,
    pub original_name: String,
    pub extension: String,
    #[ts(type = "number")]
    pub size_bytes: i64,
    pub sha256: String,
    pub created_at: Timestamp,
    pub created_by: Id,
    pub missing: bool,
    #[ts(type = "number")]
    pub row_version: i64,
}

#[derive(Serialize, TS)]
pub struct FilePurposeInfo {
    pub code: String,
    pub extensions: Vec<String>,
}
#[derive(Serialize, TS)]
pub struct FilePurposes {
    pub items: Vec<FilePurposeInfo>,
}

fn summary(record: FileRecord) -> FileSummary {
    FileSummary {
        id: record.id,
        purpose: record.purpose,
        original_name: record.original_name,
        extension: record.extension,
        size_bytes: record.size_bytes,
        sha256: record.sha256,
        created_at: record.created_at,
        created_by: record.created_by,
        missing: record.missing,
        row_version: record.row_version,
    }
}

pub fn purposes(store: &FileStore) -> FilePurposes {
    FilePurposes {
        items: store
            .purposes()
            .into_iter()
            .map(|d| FilePurposeInfo {
                code: d.code.into(),
                extensions: d.extensions.iter().map(|ext| (*ext).into()).collect(),
            })
            .collect(),
    }
}

pub async fn list(store: &FileStore, input: FileListInput) -> Result<Page<FileSummary>, AppError> {
    let page = store.list(input).await?;
    Ok(Page {
        items: page.items.into_iter().map(summary).collect(),
        total: page.total,
        page: page.page,
        page_size: page.page_size,
    })
}

pub async fn add(
    store: &FileStore,
    execution: &ExecutionContext,
    purpose: &str,
    source: &Path,
) -> Result<FileSummary, AppError> {
    let record = store.add(execution, purpose, source).await?;
    Ok(summary(record))
}

pub async fn preview(store: &FileStore, input: FileId) -> Result<FilePreview, AppError> {
    store.preview(input.id).await
}
pub async fn text_page(
    store: &FileStore,
    input: FileTextPageInput,
) -> Result<FileTextPage, AppError> {
    store.text_page(input).await
}
pub async fn save_copy(store: &FileStore, id: Id, destination: &Path) -> Result<(), AppError> {
    store.save_copy(id, destination).await
}
pub async fn delete(store: &FileStore, input: FileDelete) -> Result<(), AppError> {
    store.delete(input.id, input.row_version).await
}
pub async fn reclaim(store: &FileStore) -> Result<ReclaimReport, AppError> {
    store.reclaim().await
}

#[cfg(test)]
mod db;
