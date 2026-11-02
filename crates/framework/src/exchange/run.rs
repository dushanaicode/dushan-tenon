use super::*;
use crate::{
    actor::ExecutionContext,
    db::{Page, PageRequest, Tx},
    error::{INTERNAL_UNEXPECTED, JOB_CANCELLED},
    job::JobContext,
};
use serde_json::json;
use std::{
    fs::{self, OpenOptions},
    future::Future,
    io::{Read, Write},
    pin::Pin,
};

#[cfg(test)]
mod tests;

pub type ExchangeFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'a>>;

pub trait ExportDataset: Sync {
    type Record: Send;
    fn page(&self, request: PageRequest) -> ExchangeFuture<'_, Page<Self::Record>>;
    fn rows(&self, records: Vec<Self::Record>) -> ExchangeFuture<'_, Vec<ExchangeRow>>;
}

pub enum WriteOutcome {
    Created,
    Updated,
    Skipped,
}
pub trait ImportDataset: Sync {
    type Prepared: Send + Sync;
    fn key(&self, row: &ExchangeRow) -> String;
    fn validate(&mut self, row: &ExchangeRow) -> Result<Self::Prepared, AppError>;
    fn write<'a>(
        &'a self,
        tx: &'a mut Tx<'_>,
        execution: &'a ExecutionContext,
        row: &'a Self::Prepared,
    ) -> ExchangeFuture<'a, WriteOutcome>;
}

fn cancelled(context: &JobContext) -> Result<(), AppError> {
    if context.cancellation.is_cancelled() {
        Err(AppError::new(JOB_CANCELLED))
    } else {
        Ok(())
    }
}
fn params(current: usize, total: usize) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("current".into(), current.to_string()),
        ("total".into(), total.to_string()),
    ])
}

/// 同目录临时文件持有到 rename；future 被取消或写入失败时也清理。
struct PartialFile(PathBuf);
impl Drop for PartialFile {
    fn drop(&mut self) {
        match fs::remove_file(&self.0) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => tracing::warn!("未能删除导出临时文件"),
        }
    }
}

pub(super) fn write_file(
    exchange: &Exchange<'_>,
    path: &Path,
    id: crate::id::Id,
    rows: &[ExchangeRow],
    cancellation: &crate::job::CancellationToken,
) -> Result<(), AppError> {
    let name = path
        .file_name()
        .ok_or_else(|| invalid("file"))?
        .to_string_lossy();
    let partial = path.with_file_name(format!("{name}.{id}.partial"));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial)
        .map_err(|_| invalid("file"))?;
    let guard = PartialFile(partial);
    let bytes = exchange.write(rows, cancellation)?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| invalid("file"))?;
    drop(file);
    if cancellation.is_cancelled() {
        return Err(AppError::new(JOB_CANCELLED));
    }
    fs::rename(&guard.0, path).map_err(|_| invalid("file"))?;
    Ok(())
}

pub async fn export<D: ExportDataset>(
    context: &JobContext,
    exchange: &Exchange<'_>,
    path: &Path,
    dataset: &D,
) -> Result<Value, AppError> {
    cancelled(context)?;
    let mut request = PageRequest {
        page: 1,
        page_size: 100,
    };
    let mut records = dataset.page(request).await?;
    let total = records.total as usize;
    if total > exchange.dataset.limits.export_rows {
        return Err(too_many(exchange.dataset.limits.export_rows));
    }
    let mut rows = Vec::with_capacity(total);
    while rows.len() < total {
        cancelled(context)?;
        if records.items.is_empty() {
            break;
        }
        rows.extend(dataset.rows(records.items).await?);
        if rows.len() > exchange.dataset.limits.export_rows {
            return Err(too_many(exchange.dataset.limits.export_rows));
        }
        context
            .progress(
                rows.len() as i64,
                total.max(rows.len()) as i64,
                "exchange.progress.exporting",
                params(rows.len(), total),
            )
            .await?;
        if rows.len() >= total {
            break;
        }
        cancelled(context)?;
        request.page += 1;
        records = dataset.page(request).await?;
    }
    cancelled(context)?;
    write_file(exchange, path, context.id(), &rows, &context.cancellation)?;
    Ok(
        json!({"rows": rows.len(), "fileName": path.file_name().ok_or_else(|| invalid("file"))?.to_string_lossy()}),
    )
}

pub async fn import<D: ImportDataset>(
    context: &JobContext,
    exchange: &Exchange<'_>,
    path: &Path,
    mode: ImportMode,
    dataset: &mut D,
) -> Result<Value, AppError> {
    if !exchange.dataset.modes.contains(&mode) {
        return Err(invalid("mode"));
    }
    cancelled(context)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| invalid("file"))?
        .take(exchange.dataset.limits.file_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid("file"))?;
    let rows = exchange.read(&bytes)?;
    let total = rows.len();
    let mut report = ImportReport {
        total: total as u32,
        ..Default::default()
    };
    let mut prepared = Vec::with_capacity(total);
    let mut keys = BTreeSet::new();
    let mut error_count = 0;
    for (index, (number, row)) in rows.into_iter().enumerate() {
        cancelled(context)?;
        let (row, errors) = exchange.normalize(number, row);
        let valid = errors.is_empty();
        for error in errors {
            error_count += 1;
            report.error(error, exchange.dataset.limits);
        }
        if valid {
            let result = if keys.insert(dataset.key(&row)) {
                dataset.validate(&row)
            } else {
                Err(AppError::new(DUPLICATE_IN_FILE))
            };
            match result {
                Ok(row) => prepared.push(row),
                Err(error) => {
                    error_count += 1;
                    let column = error.params.get("path").cloned();
                    report.error(
                        RowError::new(number, column.as_deref(), error),
                        exchange.dataset.limits,
                    );
                }
            }
        }
        context
            .progress(
                index as i64 + 1,
                total as i64,
                "exchange.progress.validating",
                params(index + 1, total),
            )
            .await?;
    }
    if error_count > 0 {
        context.set_failure_result(
            serde_json::to_value(&report).map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?,
        )?;
        return Err(AppError::new(ROWS_INVALID).with_param("count", error_count.to_string()));
    }
    cancelled(context)?;
    let mut tx = context.db.begin().await?;
    let outcome = async {
        for (index, row) in prepared.iter().enumerate() {
            cancelled(context)?;
            match dataset.write(&mut tx, &context.execution, row).await? {
                WriteOutcome::Created => report.created += 1,
                WriteOutcome::Updated => report.updated += 1,
                WriteOutcome::Skipped => report.skipped += 1,
            }
            context
                .progress_in_transaction(
                    index as i64 + 1,
                    total as i64,
                    "exchange.progress.writing",
                    params(index + 1, total),
                )
                .await?;
        }
        cancelled(context)
    }
    .await;
    if let Err(error) = outcome {
        tx.rollback().await?;
        return Err(error);
    }
    tx.commit().await?;
    serde_json::to_value(report).map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
}
