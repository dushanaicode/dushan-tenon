use std::{path::Path, sync::Arc};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use super::{
    Cancellation, EXPORT_FAILED, INVALID_ARCHIVE, MAX_DATABASE, STORAGE_UNSUPPORTED, TOO_LARGE,
    UNSUPPORTED_DATABASE, regular_path, restore::DatabaseBudget, same_volume,
};
use crate::{db::Db, error::AppError};

/// 仅打开已存在的隔离恢复库，不切换 journal mode；每个连接共用同一总期限。
pub async fn open_sqlite(path: impl AsRef<Path>, budget: DatabaseBudget) -> Result<Db, AppError> {
    budget.check()?;
    let options = SqliteConnectOptions::new()
        .filename(path)
        .pragma("trusted_schema", "OFF");
    let signal = budget.clone();
    let result = SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(move |connection, _| {
            let signal = signal.clone();
            Box::pin(async move {
                connection
                    .lock_handle()
                    .await?
                    .set_progress_handler(1000, move || signal.check().is_ok());
                Ok(())
            })
        })
        .connect_with(options)
        .await;
    if let Err(error) = budget.check() {
        if let Ok(pool) = result {
            pool.close().await;
        }
        return Err(error);
    }
    Ok(Db::from_sqlite_pool(
        result.map_err(|_| AppError::new(INVALID_ARCHIVE))?,
    ))
}

/// 用户归档的在线 VACUUM INTO；db 只提供池和无归档语义的 VACUUM 原语。
pub(super) async fn snapshot_sqlite(
    db: &Db,
    destination: &Path,
    cancellation: Arc<Cancellation>,
) -> Result<(), AppError> {
    let pool = db
        .sqlite_pool()
        .ok_or_else(|| AppError::new(UNSUPPORTED_DATABASE))?;
    let destination = regular_path(destination, true)?;
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new(STORAGE_UNSUPPORTED))?;
    same_volume(pool.connect_options().get_filename(), parent)?;
    cancellation.check()?;
    let mut connection = pool
        .acquire()
        .await
        .map_err(|_| AppError::new(EXPORT_FAILED))?;
    let bytes: i64 = sqlx::query_scalar(
        "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(|_| AppError::new(EXPORT_FAILED))?;
    if bytes > MAX_DATABASE as i64 {
        return Err(AppError::new(TOO_LARGE));
    }
    let signal = cancellation.clone();
    connection
        .lock_handle()
        .await
        .map_err(|_| AppError::new(EXPORT_FAILED))?
        .set_progress_handler(1000, move || signal.check().is_ok());
    let result = crate::db::snapshot_connection(&mut connection, &destination).await;
    connection
        .lock_handle()
        .await
        .map_err(|_| AppError::new(EXPORT_FAILED))?
        .remove_progress_handler();
    cancellation.check()?;
    result.map_err(|_| AppError::new(EXPORT_FAILED))
}
