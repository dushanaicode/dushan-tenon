// 自动生成，勿手改。运行 pnpm db snapshot 更新。
#[rustfmt::skip]
pub const MIGRATIONS: &[super::migrate::Migration] = &[
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("framework", 1, "create_jobs"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/framework/0001_create_jobs.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/framework/0001_create_jobs.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/framework/0001_create_jobs.sql")),
    },
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("framework", 2, "create_job_schedules"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/framework/0002_create_job_schedules.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/framework/0002_create_job_schedules.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/framework/0002_create_job_schedules.sql")),
    },
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("framework", 3, "job_instance"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/framework/0003_job_instance.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/framework/0003_job_instance.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/framework/0003_job_instance.sql")),
    },
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("framework", 4, "create_params"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/framework/0004_create_params.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/framework/0004_create_params.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/framework/0004_create_params.sql")),
    },
    super::migrate::Migration {
        info: super::migrate::MigrationInfo::new("framework", 5, "create_files"),
        sqlite: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/sqlite/framework/0005_create_files.sql")),
        mysql: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/mysql/framework/0005_create_files.sql")),
        postgres: include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sql-snapshots/postgres/framework/0005_create_files.sql")),
    },
];
