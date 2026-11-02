use std::io;

use super::super::{Db, internal, pool::Connection};
use crate::error::AppError;

// 固定应用键；所有进程在同一数据库使用同一把锁。
const PG_KEY: i64 = 0x4455_5348_414e;

pub(super) async fn acquire(db: &Db, timeout_seconds: i64) -> Result<Connection, AppError> {
    let mut connection = db.acquire().await?;
    // 即使 future 被取消，也不把仍持有会话锁的连接放回池中。
    if db.dialect() != super::Dialect::Sqlite {
        connection.close_on_drop();
    }
    match &mut connection {
        Connection::Sqlite(_) => {}
        Connection::Mysql(connection) => {
            let acquired: Option<i64> =
                sqlx::query_scalar("SELECT GET_LOCK('tenon_schema_migration', ?)")
                    .bind(timeout_seconds)
                    .fetch_one(&mut **connection)
                    .await
                    .map_err(internal)?;
            if acquired != Some(1) {
                return Err(internal(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "MySQL migration lock acquisition failed or timed out",
                )));
            }
        }
        Connection::Postgres(connection) => {
            sqlx::query("SELECT pg_advisory_lock($1)")
                .bind(PG_KEY)
                .execute(&mut **connection)
                .await
                .map_err(internal)?;
        }
    }
    Ok(connection)
}

pub(super) async fn release(connection: &mut Connection) -> Result<(), AppError> {
    let released = match connection {
        Connection::Sqlite(_) => true,
        Connection::Mysql(connection) => {
            let released: Option<i64> =
                sqlx::query_scalar("SELECT RELEASE_LOCK('tenon_schema_migration')")
                    .fetch_one(&mut **connection)
                    .await
                    .map_err(internal)?;
            released == Some(1)
        }
        Connection::Postgres(connection) => sqlx::query_scalar("SELECT pg_advisory_unlock($1)")
            .bind(PG_KEY)
            .fetch_one(&mut **connection)
            .await
            .map_err(internal)?,
    };
    if !released {
        return Err(internal(io::Error::other(
            "migration lock was not owned by this connection",
        )));
    }
    Ok(())
}
