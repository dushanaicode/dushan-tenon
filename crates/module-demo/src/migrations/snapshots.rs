// 自动生成，勿手改。运行 pnpm db snapshot 更新。
#[rustfmt::skip]
pub const MIGRATIONS: &[super::migrate::Migration] = &[
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("demo", 1, "create_demo"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/demo/0001_create_demo.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/demo/0001_create_demo.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/demo/0001_create_demo.sql")),
    },
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("demo", 2, "sample_drafts"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/demo/0002_sample_drafts.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/demo/0002_sample_drafts.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/demo/0002_sample_drafts.sql")),
    },
];
