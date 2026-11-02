use std::{
    fs,
    future::{Future, poll_fn},
    num::NonZeroUsize,
    panic::{AssertUnwindSafe, catch_unwind, resume_unwind},
    pin::pin,
    str::FromStr,
    task::Poll,
};

use sea_query::{Query, TableStatement};
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlSslMode},
    postgres::{PgConnectOptions, PgSslMode},
};

use super::{
    Db, FromDbRow,
    migrate::{self, Dialect, Migration, MigrationStatus, UpgradeBackup},
    pool::Pool,
};
use crate::{error::AppError, id::Id};

pub struct TestDb {
    pub db: Db,
    pub root: tempfile::TempDir,
    admin: Option<Db>,
    name: String,
}

pub fn dialect() -> Dialect {
    std::env::var_os("TENON_TEST_DIALECT").map_or(Dialect::Sqlite, |value| {
        value.into_string().unwrap().parse().unwrap()
    })
}

fn connection_url(variable: &str) -> String {
    if let Some(value) = std::env::var_os(variable) {
        return value
            .into_string()
            .unwrap_or_else(|_| panic!("{variable} 必须是 UTF-8"));
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../Temp/test-resources/connection.json");
    let bytes = fs::read(path).unwrap_or_else(|_| {
        panic!("缺少 {variable} 与 Temp/test-resources/connection.json；请先准备远端测试资源")
    });
    let mut connections: std::collections::BTreeMap<String, String> =
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| panic!("Temp/test-resources/connection.json 必须是字符串映射"));
    connections
        .remove(variable)
        .unwrap_or_else(|| panic!("Temp/test-resources/connection.json 缺少 {variable}"))
}

impl TestDb {
    pub async fn new(dialect: Dialect) -> Self {
        let root = tempfile::Builder::new()
            .prefix("db-contract-")
            .tempdir_in(std::env::temp_dir())
            .unwrap();
        let name = format!("tenon_test_{}", Id::new().to_string().replace('-', ""));
        let (db, admin) = match dialect {
            Dialect::Sqlite => {
                fs::create_dir(root.path().join("data")).unwrap();
                (
                    Db::open_sqlite(root.path().join("data").join("app.db"))
                        .await
                        .unwrap(),
                    None,
                )
            }
            Dialect::Mysql | Dialect::Postgres => {
                let variable = if dialect == Dialect::Mysql {
                    "TENON_TEST_MYSQL_URL"
                } else {
                    "TENON_TEST_POSTGRES_URL"
                };
                let url = connection_url(variable);
                let admin = if dialect == Dialect::Mysql {
                    Db::open_mysql(
                        MySqlConnectOptions::from_str(&url)
                            .unwrap()
                            .ssl_mode(MySqlSslMode::Disabled),
                    )
                    .await
                    .unwrap()
                } else {
                    Db::open_postgres(
                        PgConnectOptions::from_str(&url)
                            .unwrap()
                            .ssl_mode(PgSslMode::Disable),
                    )
                    .await
                    .unwrap()
                };
                // 名称完全来自 UUID，不接受外部标识符。
                let create = if dialect == Dialect::Mysql {
                    format!("CREATE DATABASE {name} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
                } else {
                    format!("CREATE DATABASE {name}")
                };
                admin.acquire().await.unwrap().raw(&create).await.unwrap();
                let opened = if dialect == Dialect::Mysql {
                    Db::open_mysql(
                        MySqlConnectOptions::from_str(&url)
                            .unwrap()
                            .database(&name)
                            .ssl_mode(MySqlSslMode::Disabled),
                    )
                    .await
                } else {
                    Db::open_postgres(
                        PgConnectOptions::from_str(&url)
                            .unwrap()
                            .database(&name)
                            .ssl_mode(PgSslMode::Disable),
                    )
                    .await
                };
                if opened.is_err() {
                    admin
                        .acquire()
                        .await
                        .unwrap()
                        .raw(&format!("DROP DATABASE {name}"))
                        .await
                        .unwrap();
                    admin.close().await;
                }
                (opened.unwrap(), Some(admin))
            }
        };
        Self {
            db,
            root,
            admin,
            name,
        }
    }

    pub async fn raw(&self, sql: &str) {
        self.db.acquire().await.unwrap().raw(sql).await.unwrap();
    }

    pub async fn rows<T: FromDbRow>(&self, table: &str, columns: &[&str]) -> Vec<T> {
        self.db
            .fetch_all(
                &Query::select()
                    .columns(columns.iter().copied().map(sea_query::Alias::new))
                    .from(sea_query::Alias::new(table))
                    .to_owned(),
            )
            .await
            .unwrap()
    }

    pub fn sqlite_pool(&self) -> &sqlx::SqlitePool {
        let Pool::Sqlite(pool) = &self.db.pool else {
            panic!("SQLite-specific test")
        };
        pool
    }

    pub async fn upgrade(
        &self,
        migrations: &[Migration],
        keep: usize,
    ) -> Result<MigrationStatus, AppError> {
        let backup = if self.db.dialect() == Dialect::Sqlite {
            UpgradeBackup::Sqlite {
                state_root: self.root.path(),
                keep: NonZeroUsize::new(keep).unwrap(),
            }
        } else {
            UpgradeBackup::Confirmed
        };
        migrate::upgrade(&self.db, migrations, backup).await
    }

    pub fn backups(&self) -> Vec<std::path::PathBuf> {
        let directory = self.root.path().join("backups");
        if !directory.exists() {
            return vec![];
        }
        let mut paths: Vec<_> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| {
                entry.file_type().unwrap().is_file()
                    && entry.file_name().to_str().unwrap().starts_with("app-")
                    && entry.file_name().to_str().unwrap().len() == 27
            })
            .map(|entry| entry.path())
            .collect();
        paths.sort();
        paths
    }

    pub async fn close(self) {
        self.db.close().await;
        if let Some(admin) = self.admin {
            admin
                .acquire()
                .await
                .unwrap()
                .raw(&format!("DROP DATABASE {}", self.name))
                .await
                .unwrap();
            admin.close().await;
        }
        self.root.close().unwrap();
    }
}

pub fn render(statement: TableStatement, dialect: Dialect) -> String {
    match dialect {
        Dialect::Sqlite => statement.build(sea_query::SqliteQueryBuilder),
        Dialect::Mysql => statement.build(sea_query::MysqlQueryBuilder),
        Dialect::Postgres => statement.build(sea_query::PostgresQueryBuilder),
    }
}

/// 断言 panic 也先关闭池并删除本次唯一数据库，再交回测试框架。
pub async fn run(test: impl AsyncFnOnce(&TestDb)) {
    run_on(dialect(), test).await;
}

pub async fn run_on(dialect: Dialect, test: impl AsyncFnOnce(&TestDb)) {
    let database = TestDb::new(dialect).await;
    let outcome = {
        let mut future = pin!(test(&database));
        poll_fn(
            |context| match catch_unwind(AssertUnwindSafe(|| future.as_mut().poll(context))) {
                Ok(Poll::Pending) => Poll::Pending,
                Ok(Poll::Ready(())) => Poll::Ready(Ok(())),
                Err(error) => Poll::Ready(Err(error)),
            },
        )
        .await
    };
    database.close().await;
    if let Err(error) = outcome {
        resume_unwind(error);
    }
}

pub use super::schema_tests::assert_migrated_schema;
