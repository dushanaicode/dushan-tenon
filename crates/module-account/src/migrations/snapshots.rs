// 自动生成，勿手改。运行 pnpm db snapshot 更新。
#[rustfmt::skip]
pub const MIGRATIONS: &[super::migrate::Migration] = &[
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("account", 1, "create_account"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/account/0001_create_account.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/account/0001_create_account.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/account/0001_create_account.sql")),
    },
];
