// 自动生成，勿手改。运行 pnpm db snapshot 更新。
#[rustfmt::skip]
pub const MIGRATIONS: &[super::migrate::Migration] = &[
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("notify", 1, "create_notifications"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/notify/0001_create_notifications.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/notify/0001_create_notifications.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/notify/0001_create_notifications.sql")),
    },
];
