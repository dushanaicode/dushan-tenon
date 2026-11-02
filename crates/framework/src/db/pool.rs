use std::{any::Any, fmt, path::Path, time::Duration};

use sea_query::QueryStatementBuilder;
use sqlx::{
    Connection as _, MySql, MySqlPool, PgPool, Postgres, Sqlite, SqlitePool, Transaction,
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
    pool::PoolConnection,
    postgres::{PgConnectOptions, PgPoolOptions},
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

use super::{PageRequest, bind, connect::connection_error, internal, migrate::Dialect};
use crate::error::AppError;

/// 由 `#[derive(sqlx::FromRow)]` 自动满足；字段必须能在三库解码。
pub trait FromDbRow: mapping::RowMapping {}
impl<T: mapping::RowMapping> FromDbRow for T {}

mod mapping {
    use sqlx::{FromRow, mysql::MySqlRow, postgres::PgRow, sqlite::SqliteRow};

    pub enum Row {
        Sqlite(SqliteRow),
        Mysql(MySqlRow),
        Postgres(PgRow),
    }

    pub trait RowMapping: Sized {
        fn map_row(row: Row) -> Result<Self, sqlx::Error>;
    }

    impl<T> RowMapping for T
    where
        T: for<'r> FromRow<'r, SqliteRow>
            + for<'r> FromRow<'r, MySqlRow>
            + for<'r> FromRow<'r, PgRow>,
    {
        fn map_row(row: Row) -> Result<Self, sqlx::Error> {
            match row {
                Row::Sqlite(row) => Self::from_row(&row),
                Row::Mysql(row) => Self::from_row(&row),
                Row::Postgres(row) => Self::from_row(&row),
            }
        }
    }
}

// 每个分支保留 SQLx 的具体类型；参数绑定与执行流程只维护一份。
macro_rules! dispatch {
    ($inner:expr, $kind:ident, $connection:ident, $builder:ident, $row:ident, $body:expr) => {
        match $inner {
            $kind::Sqlite($connection) => {
                let $builder = sea_query::SqliteQueryBuilder;
                let $row = mapping::Row::Sqlite;
                $body
            }
            $kind::Mysql($connection) => {
                let $builder = sea_query::MysqlQueryBuilder;
                let $row = mapping::Row::Mysql;
                $body
            }
            $kind::Postgres($connection) => {
                let $builder = sea_query::PostgresQueryBuilder;
                let $row = mapping::Row::Postgres;
                $body
            }
        }
    };
}

#[derive(Clone)]
pub(super) enum Pool {
    Sqlite(SqlitePool),
    Mysql(MySqlPool),
    Postgres(PgPool),
}

#[derive(Clone)]
pub struct Db {
    pub(super) pool: Pool,
}

impl fmt::Debug for Db {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Db")
            .field("dialect", &self.dialect())
            .finish_non_exhaustive()
    }
}

impl Db {
    pub(crate) fn sqlite_pool(&self) -> Option<&SqlitePool> {
        match &self.pool {
            Pool::Sqlite(pool) => Some(pool),
            Pool::Mysql(_) | Pool::Postgres(_) => None,
        }
    }

    pub(crate) fn from_sqlite_pool(pool: SqlitePool) -> Self {
        Self {
            pool: Pool::Sqlite(pool),
        }
    }

    pub async fn open_sqlite(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5))
            .synchronous(SqliteSynchronous::Normal);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .map_err(internal)?;
        Ok(Self {
            pool: Pool::Sqlite(pool),
        })
    }

    pub(super) async fn open_mysql(options: MySqlConnectOptions) -> Result<Self, AppError> {
        let options = options.charset("utf8mb4").collation("utf8mb4_bin");
        let pool = MySqlPoolOptions::new().max_connections(4)
            .after_connect(|connection, _| Box::pin(async move {
                sqlx::query("SET time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")
                    .execute(connection).await?;
                Ok(())
            }))
            .connect_with(options).await.map_err(connection_error)?;
        Ok(Self {
            pool: Pool::Mysql(pool),
        })
    }

    pub(super) async fn open_postgres(options: PgConnectOptions) -> Result<Self, AppError> {
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .map_err(connection_error)?;
        Ok(Self {
            pool: Pool::Postgres(pool),
        })
    }

    pub fn dialect(&self) -> Dialect {
        match self.pool {
            Pool::Sqlite(_) => Dialect::Sqlite,
            Pool::Mysql(_) => Dialect::Mysql,
            Pool::Postgres(_) => Dialect::Postgres,
        }
    }

    /// SQLite 立即取得写锁；远端数据库使用默认隔离级别。
    pub async fn begin(&self) -> Result<Tx<'static>, AppError> {
        let inner = match &self.pool {
            Pool::Sqlite(pool) => TransactionInner::Sqlite(
                pool.begin_with("BEGIN IMMEDIATE").await.map_err(internal)?,
            ),
            Pool::Mysql(pool) => TransactionInner::Mysql(pool.begin().await.map_err(internal)?),
            Pool::Postgres(pool) => {
                TransactionInner::Postgres(pool.begin().await.map_err(internal)?)
            }
        };
        Ok(Tx { inner })
    }

    pub async fn close(&self) {
        dispatch!(&self.pool, Pool, pool, _builder, _row, pool.close().await);
    }

    pub async fn fetch_all<T: FromDbRow>(
        &self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<Vec<T>, AppError> {
        self.fetch_rows(statement, None).await
    }

    pub(super) async fn fetch_rows<T: FromDbRow>(
        &self,
        statement: &(impl QueryStatementBuilder + Any),
        pagination: Option<PageRequest>,
    ) -> Result<Vec<T>, AppError> {
        dispatch!(&self.pool, Pool, pool, builder, row, {
            bind::query(statement, &builder, pagination)?
                .fetch_all(pool)
                .await
                .map_err(internal)?
                .into_iter()
                .map(|value| T::map_row(row(value)))
                .collect::<Result<_, _>>()
                .map_err(internal)
        })
    }

    /// 要求查询恰有一行；缺行时返回数据库错误。
    pub(super) async fn fetch_one<T: FromDbRow>(
        &self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<T, AppError> {
        dispatch!(&self.pool, Pool, pool, builder, row, {
            let value = bind::query(statement, &builder, None)?
                .fetch_one(pool)
                .await
                .map_err(internal)?;
            T::map_row(row(value)).map_err(internal)
        })
    }

    pub async fn fetch_optional<T: FromDbRow>(
        &self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<Option<T>, AppError> {
        dispatch!(&self.pool, Pool, pool, builder, row, {
            bind::query(statement, &builder, None)?
                .fetch_optional(pool)
                .await
                .map_err(internal)?
                .map(|value| T::map_row(row(value)))
                .transpose()
                .map_err(internal)
        })
    }

    pub async fn execute(
        &self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<u64, AppError> {
        dispatch!(&self.pool, Pool, pool, builder, _row, {
            Ok(bind::query(statement, &builder, None)?
                .execute(pool)
                .await
                .map_err(internal)?
                .rows_affected())
        })
    }

    pub(super) async fn acquire(&self) -> Result<Connection, AppError> {
        Ok(match &self.pool {
            Pool::Sqlite(pool) => Connection::Sqlite(pool.acquire().await.map_err(internal)?),
            Pool::Mysql(pool) => Connection::Mysql(pool.acquire().await.map_err(internal)?),
            Pool::Postgres(pool) => Connection::Postgres(pool.acquire().await.map_err(internal)?),
        })
    }
}

pub(crate) async fn snapshot_connection(
    connection: &mut sqlx::SqliteConnection,
    path: &Path,
) -> Result<(), AppError> {
    let filename = path
        .to_str()
        .ok_or_else(|| internal(std::io::Error::other("snapshot path must be UTF-8")))?;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(internal)?;
    if let Err(error) = sqlx::query("VACUUM INTO ?")
        .bind(filename)
        .execute(connection)
        .await
    {
        std::fs::remove_file(path).map_err(internal)?;
        return Err(internal(error));
    }
    Ok(())
}

enum TransactionInner<'a> {
    Sqlite(Transaction<'a, Sqlite>),
    Mysql(Transaction<'a, MySql>),
    Postgres(Transaction<'a, Postgres>),
}

/// 丢弃时回滚。
pub struct Tx<'a> {
    inner: TransactionInner<'a>,
}

impl Tx<'_> {
    /// 内核批处理的有界读取，不执行 COUNT；limit 经独立 i64 分页绑定，不放宽业务 u64 合同。
    pub async fn fetch_batch<T: FromDbRow>(
        &mut self,
        statement: &sea_query::SelectStatement,
        limit: std::num::NonZeroU32,
    ) -> Result<Vec<T>, AppError> {
        let mut statement = statement.clone();
        statement.reset_limit().reset_offset();
        let pagination = Some(PageRequest {
            page: 1,
            page_size: limit.get(),
        });
        dispatch!(&mut self.inner, TransactionInner, tx, builder, row, {
            bind::query(&statement, &builder, pagination)?
                .fetch_all(&mut **tx)
                .await
                .map_err(internal)?
                .into_iter()
                .map(|value| T::map_row(row(value)))
                .collect::<Result<_, _>>()
                .map_err(internal)
        })
    }

    pub async fn commit(self) -> Result<(), AppError> {
        dispatch!(
            self.inner,
            TransactionInner,
            tx,
            _builder,
            _row,
            tx.commit().await.map_err(internal)
        )
    }

    pub async fn rollback(self) -> Result<(), AppError> {
        dispatch!(
            self.inner,
            TransactionInner,
            tx,
            _builder,
            _row,
            tx.rollback().await.map_err(internal)
        )
    }

    pub async fn fetch_all<T: FromDbRow>(
        &mut self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<Vec<T>, AppError> {
        dispatch!(&mut self.inner, TransactionInner, tx, builder, row, {
            bind::query(statement, &builder, None)?
                .fetch_all(&mut **tx)
                .await
                .map_err(internal)?
                .into_iter()
                .map(|value| T::map_row(row(value)))
                .collect::<Result<_, _>>()
                .map_err(internal)
        })
    }

    pub async fn fetch_optional<T: FromDbRow>(
        &mut self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<Option<T>, AppError> {
        dispatch!(&mut self.inner, TransactionInner, tx, builder, row, {
            bind::query(statement, &builder, None)?
                .fetch_optional(&mut **tx)
                .await
                .map_err(internal)?
                .map(|value| T::map_row(row(value)))
                .transpose()
                .map_err(internal)
        })
    }

    pub async fn execute(
        &mut self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<u64, AppError> {
        dispatch!(&mut self.inner, TransactionInner, tx, builder, _row, {
            Ok(bind::query(statement, &builder, None)?
                .execute(&mut **tx)
                .await
                .map_err(internal)?
                .rows_affected())
        })
    }

    pub(super) async fn raw(&mut self, sql: &str) -> Result<(), AppError> {
        dispatch!(&mut self.inner, TransactionInner, tx, _builder, _row, {
            sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
                .execute(&mut **tx)
                .await
                .map_err(internal)?;
            Ok(())
        })
    }
}

/// 迁移在同一连接持有会话锁；不向业务调用方开放原生 SQL。
pub(super) enum Connection {
    Sqlite(PoolConnection<Sqlite>),
    Mysql(PoolConnection<MySql>),
    Postgres(PoolConnection<Postgres>),
}

impl Connection {
    pub(super) fn close_on_drop(&mut self) {
        dispatch!(
            self,
            Connection,
            connection,
            _builder,
            _row,
            connection.close_on_drop()
        );
    }

    pub(super) async fn begin(&mut self) -> Result<Tx<'_>, AppError> {
        let inner = match self {
            Self::Sqlite(connection) => TransactionInner::Sqlite(
                connection
                    .begin_with("BEGIN IMMEDIATE")
                    .await
                    .map_err(internal)?,
            ),
            Self::Mysql(connection) => {
                TransactionInner::Mysql(connection.begin().await.map_err(internal)?)
            }
            Self::Postgres(connection) => {
                TransactionInner::Postgres(connection.begin().await.map_err(internal)?)
            }
        };
        Ok(Tx { inner })
    }

    pub(super) async fn execute(
        &mut self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<u64, AppError> {
        dispatch!(self, Connection, connection, builder, _row, {
            Ok(bind::query(statement, &builder, None)?
                .execute(&mut **connection)
                .await
                .map_err(internal)?
                .rows_affected())
        })
    }

    pub(super) async fn fetch_all<T: FromDbRow>(
        &mut self,
        statement: &(impl QueryStatementBuilder + Any),
    ) -> Result<Vec<T>, AppError> {
        dispatch!(self, Connection, connection, builder, row, {
            bind::query(statement, &builder, None)?
                .fetch_all(&mut **connection)
                .await
                .map_err(internal)?
                .into_iter()
                .map(|value| T::map_row(row(value)))
                .collect::<Result<_, _>>()
                .map_err(internal)
        })
    }

    pub(super) async fn raw(&mut self, sql: &str) -> Result<(), AppError> {
        dispatch!(self, Connection, connection, _builder, _row, {
            sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
                .execute(&mut **connection)
                .await
                .map_err(internal)?;
            Ok(())
        })
    }
}
