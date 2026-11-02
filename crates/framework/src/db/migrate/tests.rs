use std::fs;

use super::*;
use crate::db::test_support;

pub(in crate::db) const MIGRATIONS: [Migration; 3] = [
    Migration {
        info: MigrationInfo::new("fixture", 1, "create_items"),
        sqlite: "CREATE TABLE items(id BIGINT NOT NULL PRIMARY KEY); INSERT INTO items VALUES (1);",
        mysql: "CREATE TABLE items(id BIGINT NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin; INSERT INTO items VALUES (1);",
        postgres: "CREATE TABLE items(id BIGINT NOT NULL PRIMARY KEY); INSERT INTO items VALUES (1);",
    },
    Migration {
        info: MigrationInfo::new("fixture", 2, "add_label"),
        sqlite: "ALTER TABLE items ADD COLUMN label TEXT; UPDATE items SET label = 'second';",
        mysql: "ALTER TABLE items ADD COLUMN label TEXT; UPDATE items SET label = 'second';",
        postgres: "ALTER TABLE items ADD COLUMN label TEXT; UPDATE items SET label = 'second';",
    },
    Migration {
        info: MigrationInfo::new("fixture", 3, "create_other"),
        sqlite: "CREATE TABLE other(id VARCHAR(36) NOT NULL PRIMARY KEY, enabled BOOLEAN NOT NULL, counter BIGINT, label TEXT, code VARCHAR(128) NOT NULL, UNIQUE(code, enabled));",
        mysql: "CREATE TABLE other(id VARCHAR(36) NOT NULL PRIMARY KEY, enabled BOOLEAN NOT NULL, counter BIGINT, label TEXT, code VARCHAR(128) NOT NULL, UNIQUE(code, enabled)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;",
        postgres: "CREATE TABLE other(id VARCHAR(36) NOT NULL PRIMARY KEY, enabled BOOLEAN NOT NULL, counter BIGINT, label TEXT, code VARCHAR(128) NOT NULL, UNIQUE(code, enabled));",
    },
];

#[tokio::test(flavor = "current_thread")]
async fn pending_migrations_run_once_in_order_and_empty_registry_only_bootstraps() {
    test_support::run(async |test| {
        let empty = test.upgrade(&[], 5).await.unwrap();
        assert!(empty.applied.is_empty() && empty.pending.is_empty());
        assert!(!test.root.path().join("backups").exists());
        assert!(
            test.rows::<(String,)>("fw_schema_migration", &["module"])
                .await
                .is_empty()
        );
        let pending = status(&test.db, &MIGRATIONS).await.unwrap();
        assert_eq!(
            pending
                .pending
                .iter()
                .map(|info| info.version)
                .collect::<Vec<_>>(),
            [1, 2, 3]
        );
        let done = test.upgrade(&MIGRATIONS, 5).await.unwrap();
        assert_eq!(done.applied.len(), 3);
        assert!(done.pending.is_empty());
        assert_eq!(
            done.applied[0].checksum,
            checksum(MIGRATIONS[0].sql(test.db.dialect()).as_bytes())
        );
        assert!(
            done.applied
                .iter()
                .all(|record| record.applied_at > 0 && record.duration_ms >= 0)
        );
        let rows: Vec<(i64, String)> = test.rows("items", &["id", "label"]).await;
        assert_eq!(rows, vec![(1, "second".into())]);
        let before = test.backups();
        assert_eq!(test.upgrade(&MIGRATIONS, 5).await.unwrap().applied.len(), 3);
        assert_eq!(test.backups(), before);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn backups_precede_upgrade_and_prune_only_matching_regular_files() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        test.upgrade(&MIGRATIONS[..1], 2).await.unwrap();
        let backup = &test.backups()[0];
        let pool = sqlx::SqlitePool::connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(backup)
                .read_only(true),
        )
        .await
        .unwrap();
        let tables: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE name = 'items'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            tables.0, 0,
            "backup must be taken before the first migration"
        );
        pool.close().await;
        let directory = test.root.path().join("backups");
        let unrelated = directory.join("manual.db");
        fs::write(&unrelated, "keep").unwrap();
        let malformed = directory.join("app-123.db");
        fs::write(&malformed, "keep").unwrap();
        let matching_directory = directory.join("app-00000000000000000000.db");
        fs::create_dir(&matching_directory).unwrap();
        let first = test.backups()[0].clone();
        test.upgrade(&MIGRATIONS[..2], 2).await.unwrap();
        test.upgrade(&MIGRATIONS, 2).await.unwrap();
        assert_eq!(test.backups().len(), 2);
        assert!(!first.exists());
        assert_eq!(fs::read_to_string(unrelated).unwrap(), "keep");
        assert!(malformed.exists() && matching_directory.is_dir());
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn newer_checksum_name_failed_and_running_states_refuse_startup_without_backup() {
    for (change, expected) in [
        (
            "UPDATE fw_schema_migration SET version = 99",
            DATABASE_NEWER_THAN_APP,
        ),
        (
            "UPDATE fw_schema_migration SET checksum = 'changed'",
            CHECKSUM_MISMATCH,
        ),
        (
            "UPDATE fw_schema_migration SET name = 'changed'",
            CHECKSUM_MISMATCH,
        ),
        (
            "UPDATE fw_schema_migration SET status = 'failed'",
            FAILED_MIGRATION,
        ),
        (
            "UPDATE fw_schema_migration SET status = 'running'",
            FAILED_MIGRATION,
        ),
    ] {
        test_support::run(async |test| {
            test.upgrade(&MIGRATIONS[..1], 5).await.unwrap();
            test.raw(change).await;
            let before = test.backups();
            let error = test.upgrade(&MIGRATIONS, 5).await.unwrap_err();
            assert_eq!(error.code, expected, "{change}");
            assert_eq!(test.backups(), before);
        })
        .await;
    }
}

#[tokio::test(flavor = "current_thread")]
async fn transactional_failure_rolls_back_script_and_record_but_nontransactional_failure_is_durable()
 {
    for transactional in [true, false] {
        test_support::run(async |test| {
            let mut migration = MIGRATIONS[0];
            migration.info.transactional = transactional;
            let broken = "CREATE TABLE partial(id BIGINT); INSERT INTO missing VALUES (1);";
            migration.sqlite = broken;
            migration.mysql = broken;
            migration.postgres = broken;
            let error = test.upgrade(&[migration], 5).await.unwrap_err();
            assert_eq!(error.code, FAILED_MIGRATION);
            let report = status(&test.db, &[migration]).await.unwrap();
            let transactional = transactional && test.db.dialect() != Dialect::Mysql;
            let query = Query::select().column("id").from("partial").to_owned();
            // PostgreSQL 同一个 simple-query 消息中的多条 SQL 也会隐式作为一个事务。
            assert_eq!(
                test.db.fetch_all::<(i64,)>(&query).await.is_ok(),
                !transactional && test.db.dialect() != Dialect::Postgres
            );
            if transactional {
                assert_eq!(report.pending.len(), 1);
                assert!(report.failed.is_empty());
                assert_eq!(
                    test.upgrade(&MIGRATIONS[..1], 5)
                        .await
                        .unwrap()
                        .applied
                        .len(),
                    1
                );
            } else {
                assert!(report.pending.is_empty());
                assert_eq!(report.failed[0].status, "failed");
                assert_eq!(
                    report.failed[0].checksum,
                    checksum(migration.sql(test.db.dialect()).as_bytes())
                );
                assert_eq!(
                    test.upgrade(&[migration], 5).await.unwrap_err().code,
                    FAILED_MIGRATION
                );
            }
        })
        .await;
    }
}

#[tokio::test(flavor = "current_thread")]
async fn nontransactional_success_is_not_repeated_and_backup_failure_prevents_execution() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        fs::write(test.root.path().join("backups"), "not a directory").unwrap();
        assert!(test.upgrade(&MIGRATIONS, 5).await.is_err());
        assert_eq!(
            status(&test.db, &MIGRATIONS).await.unwrap().pending.len(),
            3
        );
        fs::remove_file(test.root.path().join("backups")).unwrap();
        let migration = Migration {
            info: MIGRATIONS[0].info.non_transactional(),
            ..MIGRATIONS[0]
        };
        for _ in 0..2 {
            let report = test.upgrade(&[migration], 5).await.unwrap();
            assert_eq!(report.applied.len(), 1);
            assert_eq!(report.applied[0].status, "succeeded");
        }
    })
    .await;
}

#[test]
fn export_uses_requested_dialect_and_registration_order_across_modules() {
    let second_module = Migration {
        info: MigrationInfo::new("other", 1, "first"),
        postgres: "-- other module\n",
        ..MIGRATIONS[0]
    };
    let migrations = [MIGRATIONS[0], second_module, MIGRATIONS[1]];
    assert_eq!(
        export_sql(&migrations, Dialect::Postgres).unwrap(),
        [
            MIGRATIONS[0].postgres,
            second_module.postgres,
            MIGRATIONS[1].postgres
        ]
        .join("\n")
    );
    assert!(export_sql(&[], Dialect::Mysql).unwrap().is_empty());
    assert!(export_sql(&MIGRATIONS[1..], Dialect::Sqlite).is_err());
}

#[tokio::test(flavor = "current_thread")]
async fn startup_upgrades_sqlite_but_requires_explicit_remote_upgrade() {
    test_support::run(async |test| {
        let result = startup(
            &test.db,
            &MIGRATIONS,
            test.root.path(),
            NonZeroUsize::new(2).unwrap(),
        )
        .await;
        if test.db.dialect() == Dialect::Sqlite {
            assert_eq!(result.unwrap().applied.len(), 3);
            assert_eq!(test.backups().len(), 1);
        } else {
            assert_eq!(result.unwrap_err().code, UPGRADE_REQUIRED);
            assert_eq!(
                status(&test.db, &MIGRATIONS).await.unwrap().pending.len(),
                3
            );
            assert!(test.backups().is_empty());
            test.upgrade(&MIGRATIONS, 2).await.unwrap();
        }
        assert_eq!(
            startup(
                &test.db,
                &MIGRATIONS,
                test.root.path(),
                NonZeroUsize::new(2).unwrap()
            )
            .await
            .unwrap()
            .applied
            .len(),
            3
        );
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn remote_upgrade_lock_excludes_other_connections_and_rechecks_after_waiting() {
    if test_support::dialect() == Dialect::Sqlite {
        return;
    }
    test_support::run(async |test| {
        let mut held = lock::acquire(&test.db, 30).await.unwrap();
        if test.db.dialect() == Dialect::Mysql {
            assert!(
                lock::acquire(&test.db, 0).await.is_err(),
                "GET_LOCK timeout must fail"
            );
        }
        let mut first = std::pin::pin!(test.upgrade(&MIGRATIONS, 1));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(150), &mut first)
                .await
                .is_err(),
            "upgrade must wait for the held session lock"
        );
        lock::release(&mut held).await.unwrap();
        drop(held);
        let (first, second) = tokio::join!(first, test.upgrade(&MIGRATIONS, 1));
        assert_eq!(first.unwrap().applied.len(), 3);
        assert_eq!(second.unwrap().applied.len(), 3);
        let mut available = lock::acquire(&test.db, 30).await.unwrap();
        lock::release(&mut available).await.unwrap();
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn nontransactional_success_is_not_repeated_on_any_dialect() {
    test_support::run(async |test| {
        let migration = Migration {
            info: MIGRATIONS[0].info.non_transactional(),
            ..MIGRATIONS[0]
        };
        for _ in 0..2 {
            assert_eq!(
                test.upgrade(&[migration], 1).await.unwrap().applied.len(),
                1
            );
        }
    })
    .await;
}
