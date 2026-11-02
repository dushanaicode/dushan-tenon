use std::{fs, num::NonZeroUsize, path::Path};

use super::super::internal;
use crate::error::AppError;

pub(super) async fn create(
    connection: &mut sqlx::SqliteConnection,
    state_root: &Path,
    keep: NonZeroUsize,
) -> Result<(), AppError> {
    let directory = state_root.join("backups");
    fs::create_dir_all(&directory).map_err(internal)?;
    // 固定 20 位 Unix 纳秒，字典序即时间序；create_new 避免覆盖任何现有文件。
    let name = format!("app-{:020}.db", jiff::Timestamp::now().as_nanosecond());
    let path = directory.join(name);
    super::super::pool::snapshot_connection(connection, &path).await?;
    // 仅在备份成功后清理普通文件；不跟随符号链接，不递归删除。
    let mut backups = Vec::new();
    for entry in fs::read_dir(&directory).map_err(internal)? {
        let entry = entry.map_err(internal)?;
        let name = entry.file_name();
        if entry.file_type().map_err(internal)?.is_file()
            && name.to_str().is_some_and(is_backup_name)
        {
            backups.push(entry.path());
        }
    }
    backups.sort();
    for path in backups
        .iter()
        .take(backups.len().saturating_sub(keep.get()))
    {
        fs::remove_file(path).map_err(internal)?;
    }
    tracing::info!(path = %path.display(), "数据库升级前备份完成");
    Ok(())
}

pub(super) fn is_backup_name(name: &str) -> bool {
    name.strip_prefix("app-")
        .and_then(|name| name.strip_suffix(".db"))
        .is_some_and(|timestamp| {
            timestamp.len() == 20 && timestamp.bytes().all(|byte| byte.is_ascii_digit())
        })
}
