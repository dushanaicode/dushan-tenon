use super::*;
use crate::{
    actor::{Actor, ExecutionContext},
    db::{migrate::Dialect, test_support},
    file::{FilePurposeDeclaration, FileStore},
    id::Id,
    instance::InstanceId,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    sync::Arc,
};

async fn setup(test: &test_support::TestDb, output: &std::path::Path) -> BackupInput {
    test.upgrade(crate::migrations::MIGRATIONS, 5)
        .await
        .unwrap();
    let instance = InstanceId::load_or_create(test.root.path()).unwrap();
    let files = FileStore::new(
        test.db.clone(),
        test.root.path(),
        instance,
        20,
        &[FilePurposeDeclaration {
            code: "fixture.attachment",
            extensions: &["txt"],
        }],
    );
    fs::write(
        test.root.path().join("input.txt"),
        "private business content",
    )
    .unwrap();
    files
        .add(
            &ExecutionContext::new(Actor::User(Id::new()), "trace"),
            "fixture.attachment",
            &test.root.path().join("input.txt"),
        )
        .await
        .unwrap();
    fs::write(test.root.path().join("config.toml"), "# comment-secret-sentinel\n[ui]\nlanguage=\"en-US\"\n[network]\nproxy_endpoint=\"https://excluded.invalid\"\n").unwrap();
    fs::write(
        test.root.path().join("log-secret-sentinel"),
        "log-secret-sentinel",
    )
    .unwrap();
    BackupInput {
        db: test.db.clone(),
        files,
        state_root: test.root.path().to_owned(),
        scratch: output.join("staging"),
        destination: output.join("copy.tenon-backup.zip"),
        config_projection:
            b"{ \"formatVersion\": 7, \"ui\": {\"language\":\"en-US\"}, \"future\": [1, true] }\n"
                .to_vec(),
        product_id: "fixture".into(),
        app_version: "0.1.0".into(),
        migrations: crate::migrations::MIGRATIONS.to_vec(),
    }
}

pub(super) fn workspace() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP")).unwrap()
}

#[tokio::test]
async fn remote_snapshot_rejected_without_connecting() {
    for dialect in [Dialect::Mysql, Dialect::Postgres] {
        let db = test_support::lazy_remote(dialect);
        let root = workspace();
        let error = super::sqlite::snapshot_sqlite(
            &db,
            &root.path().join("snapshot.db"),
            Arc::new(Cancellation::default()),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code(), UNSUPPORTED_DATABASE);
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        db.close().await;
    }
}

#[tokio::test]
async fn projection_rejects_invalid_json_and_oversize_without_replacing_target() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        for (projection, expected) in [
            (b"[invalid".to_vec(), INVALID_ARCHIVE),
            (b"\"\xff\"".to_vec(), INVALID_ARCHIVE),
            (b"\"\\uD800\"".to_vec(), INVALID_ARCHIVE),
            (vec![b' '; MAX_MANIFEST as usize + 1], TOO_LARGE),
        ] {
            let mut input = setup(test, output.path()).await;
            input.config_projection = projection;
            let destination = input.destination.clone();
            fs::write(&destination, b"previous backup").unwrap();
            let error = export(
                input,
                Arc::new(Cancellation::default()),
                Arc::new(|_, _, _| {}),
            )
            .await
            .unwrap_err();
            assert_eq!(error.code(), expected);
            assert_eq!(fs::read(&destination).unwrap(), b"previous backup");
        }
    })
    .await;
}

#[test]
fn diagnostics_target_rechecks_changes_and_preserves_existing_files() {
    let root = workspace();
    let state = root.path().join("state");
    fs::create_dir(&state).unwrap();
    let scratch = root.path().join("stage");
    let path = root.path().join("selected.tenon-diagnostics.zip");
    for case in ["modified", "replaced", "created", "cancelled", "unchanged"] {
        if path.exists() {
            fs::remove_file(&path).unwrap();
        }
        if case != "created" {
            fs::write(&path, b"original").unwrap();
        }
        let cancel = Cancellation::default();
        let target = Target::capture_diagnostics(&path, &state, &scratch, &cancel).unwrap();
        match case {
            "modified" | "created" => fs::write(&path, b"new-data").unwrap(),
            "replaced" => {
                fs::rename(&path, root.path().join("previous.zip")).unwrap();
                fs::write(&path, b"replaced").unwrap();
            }
            "cancelled" => cancel.cancel(),
            "unchanged" => {}
            _ => panic!("unexpected test case"),
        }
        let current = fs::read(&path).unwrap();
        let mut staged = tempfile::NamedTempFile::new_in(&scratch).unwrap();
        staged.write_all(b"diagnostic").unwrap();
        let result = target.commit(staged, &cancel);
        if case == "unchanged" {
            result.unwrap();
            assert_eq!(fs::read(&path).unwrap(), b"diagnostic");
        } else {
            assert!(result.is_err(), "{case}");
            assert_eq!(fs::read(&path).unwrap(), current, "{case}");
        }
    }
    for path in [
        state.join("inside.tenon-diagnostics.zip"),
        scratch.join("inside.tenon-diagnostics.zip"),
        root.path().join("wrong.zip"),
        root.path().join("backup.tenon-backup.zip"),
    ] {
        assert_eq!(
            Target::capture_diagnostics(&path, &state, &scratch, &Cancellation::default())
                .err()
                .unwrap()
                .code(),
            STORAGE_UNSUPPORTED,
        );
    }
    assert_eq!(
        Target::capture(&path, &state, &scratch, &Cancellation::default())
            .err()
            .unwrap()
            .code(),
        STORAGE_UNSUPPORTED,
    );
}

#[test]
fn storage_creates_explicit_temp_parent_without_a_system_fallback() {
    let output = workspace();
    let state = output.path().join("state");
    fs::create_dir(&state).unwrap();
    let scratch = output.path().join("Temp/backup");
    check_layout(&state, &scratch).unwrap();
    assert!(scratch.is_dir());
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 0);
}

#[tokio::test]
async fn snapshot_matches_live_sqlite_and_files() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        let path = input.destination.clone();
        let expected_files = test
            .rows::<(String, String)>("fw_file", &["stored_path", "sha256"])
            .await;
        let (bytes, hash) = export(
            input,
            Arc::new(Cancellation::default()),
            Arc::new(|_, _, _| {}),
        )
        .await
        .unwrap();
        let raw = fs::read(&path).unwrap();
        assert_eq!(bytes, raw.len() as u64);
        assert_eq!(hash, format!("{:x}", Sha256::digest(&raw)));
        let manifest = validate_archive(&path, "fixture", &Cancellation::default()).unwrap();
        assert_eq!(manifest.entries.len(), 3);
        assert_eq!(
            manifest.migration_records.len(),
            crate::migrations::MIGRATIONS.len()
        );
        let mut zip = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        assert_eq!(zip.len(), 4);
        let mut config = String::new();
        zip.by_name("config.json")
            .unwrap()
            .read_to_string(&mut config)
            .unwrap();
        assert_eq!(
            config.as_bytes(),
            b"{ \"formatVersion\": 7, \"ui\": {\"language\":\"en-US\"}, \"future\": [1, true] }\n"
        );
        let projection = manifest
            .entries
            .iter()
            .find(|entry| entry.path == "config.json")
            .unwrap();
        assert_eq!(projection.bytes, config.len() as u64);
        assert_eq!(
            projection.sha256,
            format!("{:x}", Sha256::digest(config.as_bytes()))
        );
        let mut manifest_json = Vec::new();
        zip.by_name("manifest.json")
            .unwrap()
            .read_to_end(&mut manifest_json)
            .unwrap();
        let manifest_json: serde_json::Value = serde_json::from_slice(&manifest_json).unwrap();
        assert!(manifest_json.get("configProjectionVersion").is_none());
        for forbidden in [
            "comment-secret-sentinel",
            "excluded.invalid",
            "log-secret-sentinel",
        ] {
            assert!(!String::from_utf8_lossy(&raw).contains(forbidden));
        }
        let (stored, sha) = &expected_files[0];
        let mut content = Vec::new();
        zip.by_name(&format!("files/{stored}"))
            .unwrap()
            .read_to_end(&mut content)
            .unwrap();
        assert_eq!(format!("{:x}", Sha256::digest(&content)), *sha);
        assert_eq!(content, b"private business content");
        let snapshot_path = output.path().join("verified.db");
        let mut snapshot_file = fs::File::create(&snapshot_path).unwrap();
        std::io::copy(
            &mut zip.by_name("database/app.db").unwrap(),
            &mut snapshot_file,
        )
        .unwrap();
        drop(snapshot_file);
        let snapshot = crate::db::Db::open_sqlite(snapshot_path).await.unwrap();
        let rows: Vec<(String, String)> = snapshot
            .fetch_all(
                &sea_query::Query::select()
                    .columns(["stored_path", "sha256"])
                    .from("fw_file")
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(rows, expected_files);
        snapshot.close().await;
        assert_eq!(
            fs::read_dir(output.path().join("staging")).unwrap().count(),
            0
        );
    })
    .await;
}

#[tokio::test]
async fn backup_quiescence_blocks_all_writers() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        let gate = crate::maintenance::OperationGate::default();
        let exclusive = gate.quiesce().await.unwrap();
        let other = gate.clone();
        export(input, Arc::new(Cancellation::default()), Arc::new(move |_, _, _| {
            assert_eq!(other.enter().err().unwrap().code(), crate::maintenance::OPERATION_BUSY);
        })).await.unwrap();
        drop(exclusive);
        assert!(gate.enter().is_ok());
        test.raw("INSERT INTO fw_job (id,kind,module,status,payload,priority,attempts,max_attempts,retry_safe,cancel_requested,run_after,created_at,updated_at,row_version) VALUES ('pending','disabled.job','disabled','queued','{}',0,0,1,0,0,0,0,0,1)").await;
        assert_eq!(check_quiescent(&test.db).await.unwrap_err().code(), NOT_QUIESCENT);
        test.raw("UPDATE fw_job SET status='succeeded'").await;
        check_quiescent(&test.db).await.unwrap();
    }).await;
}

#[tokio::test]
async fn archive_limits_and_cancel_preserve_target() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let first = setup(test, output.path()).await;
        let path = first.destination.clone();
        fs::write(&path, b"old target").unwrap();
        for phase in [0, 1, 2, 3] {
            let files = first.files.clone();
            let input = BackupInput {
                db: test.db.clone(),
                files,
                state_root: first.state_root.clone(),
                scratch: first.scratch.clone(),
                destination: path.clone(),
                config_projection: first.config_projection.clone(),
                product_id: first.product_id.clone(),
                app_version: first.app_version.clone(),
                migrations: first.migrations.clone(),
            };
            let cancel = Arc::new(Cancellation::default());
            let signal = cancel.clone();
            let result = export(
                input,
                cancel,
                Arc::new(move |stage, _, _| {
                    let index = match stage {
                        Phase::Snapshotting => 0,
                        Phase::Copying => 1,
                        Phase::Archiving => 2,
                        Phase::Verifying => 3,
                    };
                    if index == phase {
                        signal.cancel();
                    }
                }),
            )
            .await;
            assert_eq!(result.unwrap_err().code(), CANCELLED);
            assert_eq!(fs::read(&path).unwrap(), b"old target");
            assert_eq!(fs::read_dir(&first.scratch).unwrap().count(), 0);
        }
        let cancel = Cancellation::default();
        let target = Target::capture(&path, test.root.path(), &first.scratch, &cancel).unwrap();
        fs::write(&path, b"changed externally").unwrap();
        let tmp = tempfile::NamedTempFile::new_in(&first.scratch).unwrap();
        assert_eq!(
            target.commit(tmp, &cancel).unwrap_err().code(),
            EXPORT_FAILED
        );
        assert_eq!(fs::read(&path).unwrap(), b"changed externally");
        let target = Target::capture(&path, test.root.path(), &first.scratch, &cancel).unwrap();
        let mut tmp = tempfile::NamedTempFile::new_in(&first.scratch).unwrap();
        tmp.write_all(b"committed").unwrap();
        target.commit(tmp, &cancel).unwrap();
        cancel.cancel();
        cancel.check().unwrap();
        assert!(!cancel.can_cancel());
        assert_eq!(fs::read(&path).unwrap(), b"committed");
        assert!(
            Target::capture(
                &test.root.path().join("config.toml"),
                test.root.path(),
                &first.scratch,
                &Cancellation::default()
            )
            .is_err()
        );
        let missing = test.rows::<(String,)>("fw_file", &["stored_path"]).await;
        fs::write(
            test.root.path().join("files").join(&missing[0].0),
            b"X".repeat(b"private business content".len()),
        )
        .unwrap();
        assert_eq!(
            export(
                first,
                Arc::new(Cancellation::default()),
                Arc::new(|_, _, _| {})
            )
            .await
            .unwrap_err()
            .code(),
            HASH_MISMATCH
        );
        assert_eq!(fs::read(&path).unwrap(), b"committed");
    })
    .await;
}

#[test]
fn archive_rejects_paths_versions_links_sizes_and_duplicates() {
    for path in [
        "../escape",
        "/absolute",
        "C:/file",
        "//server/file",
        "files\\a",
        "files/2026/01/CON",
        "files/2026/01/id:ads",
        "logs/raw",
        "DATABASE/app.db",
    ] {
        assert_eq!(
            manifest::entry_limit(path).unwrap_err().code(),
            INVALID_ARCHIVE
        );
    }
    let mut manifest = BackupManifest {
        format: "tenon-backup".into(),
        format_version: 1,
        product_id: "fixture".into(),
        app_version: "0.1.0".into(),
        created_at: jiff::Timestamp::now().to_string(),
        source_instance_id: Id::new().to_string(),
        database_kind: "sqlite".into(),
        migration_records: vec![],
        total_bytes: 0,
        excluded: manifest::EXCLUDED.iter().map(|s| (*s).into()).collect(),
        entries: ["database/app.db", "config.json"]
            .map(|path| ManifestEntry {
                path: path.into(),
                bytes: 0,
                sha256: format!("{:x}", Sha256::digest([])),
            })
            .to_vec(),
    };
    manifest.validate("fixture").unwrap();
    manifest.format = "obsolete-backup".into();
    assert_eq!(
        manifest.validate("fixture").unwrap_err().code(),
        INVALID_ARCHIVE
    );
    manifest.format = "tenon-backup".into();
    manifest.format_version = 2;
    assert_eq!(
        manifest.validate("fixture").unwrap_err().code(),
        INVALID_ARCHIVE
    );
    manifest.format_version = 1;
    manifest.entries[0].bytes = MAX_DATABASE + 1;
    assert_eq!(manifest.validate("fixture").unwrap_err().code(), TOO_LARGE);
    manifest.entries[0].bytes = 0;
    manifest.entries.push(manifest.entries[0].clone());
    assert_eq!(
        manifest.validate("fixture").unwrap_err().code(),
        INVALID_ARCHIVE
    );
    manifest.entries.pop();
    let output = workspace();
    let path = output.path().join("adversarial.zip");
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("manifest.json", options).unwrap();
    zip.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    zip.add_symlink("database/app.db", "../../outside", options)
        .unwrap();
    zip.start_file("config.json", options).unwrap();
    zip.finish().unwrap();
    assert!(validate_archive(&path, "fixture", &Cancellation::default()).is_err());
    let mut raw = fs::read(&path).unwrap();
    let footer = raw.len() - 22;
    raw[footer + 8..footer + 12].copy_from_slice(&[4, 0, 4, 0]);
    fs::write(&path, raw).unwrap();
    assert_eq!(
        validate_archive(&path, "fixture", &Cancellation::default())
            .unwrap_err()
            .code(),
        INVALID_ARCHIVE
    );
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    zip.start_file("manifest.json", options).unwrap();
    zip.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    for name in ["database/app.db", "config.json", "database/dup.db"] {
        zip.start_file(name, options).unwrap();
    }
    zip.finish().unwrap();
    let mut raw = fs::read(&path).unwrap();
    let from = b"database/dup.db";
    let offsets: Vec<_> = raw
        .windows(from.len())
        .enumerate()
        .filter_map(|(i, b)| (b == from).then_some(i))
        .collect();
    assert_eq!(offsets.len(), 2);
    for i in offsets {
        raw[i..i + from.len()].copy_from_slice(b"database/app.db");
    }
    fs::write(&path, &raw).unwrap();
    // 库确实隐藏了重复名称；EOCD 交叉校验仍必须拒绝它。
    assert_eq!(
        zip::ZipArchive::new(std::io::Cursor::new(raw))
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        validate_archive(&path, "fixture", &Cancellation::default())
            .unwrap_err()
            .code(),
        INVALID_ARCHIVE
    );
    for case in ["valid", "invalid_json", "projection_version", "old_entry"] {
        let projection: &[u8] = if case == "invalid_json" { b"[" } else { b"{}" };
        manifest.entries[1] = ManifestEntry {
            path: if case == "old_entry" {
                "config.toml"
            } else {
                "config.json"
            }
            .into(),
            bytes: projection.len() as u64,
            sha256: format!("{:x}", Sha256::digest(projection)),
        };
        manifest.total_bytes = projection.len() as u64;
        let mut declared = serde_json::to_value(&manifest).unwrap();
        if case == "projection_version" {
            declared["configProjectionVersion"] = 1.into();
        }
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, bytes) in [
            ("manifest.json", serde_json::to_vec(&declared).unwrap()),
            ("database/app.db", Vec::new()),
            (manifest.entries[1].path.as_str(), projection.to_vec()),
        ] {
            zip.start_file(name, options).unwrap();
            zip.write_all(&bytes).unwrap();
        }
        zip.finish().unwrap();
        let result = validate_archive(&path, "fixture", &Cancellation::default());
        if case == "valid" {
            result.unwrap();
        } else {
            assert_eq!(result.unwrap_err().code(), INVALID_ARCHIVE, "{case}");
        }
    }
}

#[tokio::test]
async fn restore_rebinds_files_and_never_replays_jobs() {
    use crate::db::{
        Db,
        migrate::{Migration, MigrationInfo},
    };
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        let source_instance = input.files.instance_id();
        test.raw("INSERT INTO fw_job (id,kind,module,status,payload,priority,attempts,max_attempts,retry_safe,cancel_requested,run_after,created_at,updated_at,row_version) VALUES ('done','disabled.job','disabled','succeeded','{}',0,1,1,0,0,0,0,0,1)").await;
        let archive = input.destination.clone();
        export(input, Arc::new(Cancellation::default()), Arc::new(|_, _, _| {})).await.unwrap();
        let archive_before = fs::read(&archive).unwrap();
        let operation = output.path().join("operation");
        fs::create_dir(&operation).unwrap();
        let cancel = Cancellation::default();
        let (manifest, _) = restore::extract(&archive, &operation, "fixture", &cancel).unwrap();
        let target = output.path().join("target");
        fs::create_dir(&target).unwrap();
        let target_instance = InstanceId::load_or_create(&target).unwrap();
        assert_ne!(source_instance, target_instance);
        fs::write(target.join("config.toml"), "[ui]\nlanguage='zh-CN'\ndeveloper_mode=true\n[network]\nproxy_endpoint='https://target.invalid'\n[shortcuts]\nshow_main='Ctrl+Shift+Y'\n[cache]\nprovider='local'\n").unwrap();
        let original_config = fs::read(target.join("config.toml")).unwrap();
        let stage = operation.join("stage");
        let projection = restore::read_config_projection(&stage).unwrap();
        assert_eq!(projection, b"{ \"formatVersion\": 7, \"ui\": {\"language\":\"en-US\"}, \"future\": [1, true] }\n");
        let mut migrations = crate::migrations::MIGRATIONS.to_vec();
        migrations.push(Migration {
            info: MigrationInfo::new("fixture", 1, "restore_probe"),
            sqlite: "CREATE TABLE restore_probe (id INTEGER NOT NULL PRIMARY KEY);",
            mysql: "", postgres: "",
        });
        let budget = restore::DatabaseBudget::new(Arc::new(cancel), restore::DATABASE_TIMEOUT);
        assert!(restore::prepare_database(&stage, &manifest, &migrations, target_instance, &budget).await.unwrap());
        let db = Db::open_sqlite(stage.join("data/app.db")).await.unwrap();
        let schema: Vec<(String, Option<String>)> = db.fetch_all(
            &sea_query::Query::select().columns(["name", "sql"]).from("sqlite_schema").to_owned(),
        ).await.unwrap();
        let autoindexes: Vec<_> = schema.iter()
            .filter(|(name, _)| name.starts_with("sqlite_autoindex_"))
            .collect();
        assert!(!autoindexes.is_empty(), "restored fixture must contain engine autoindexes");
        assert!(autoindexes.iter().all(|(_, sql)| sql.is_none()));
        let files = FileStore::new(db.clone(), &stage, target_instance, 20, &[]);
        let entries = archive::snapshot_entries(&files, &db).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(fs::read(stage.join(&entries[0].path)).unwrap(), b"private business content");
        let jobs: Vec<(String, String, i64)> = db.fetch_all(
            &sea_query::Query::select().columns(["id", "status", "attempts"]).from("fw_job").to_owned(),
        ).await.unwrap();
        assert_eq!(jobs, [("done".into(), "succeeded".into(), 1)]);
        check_quiescent(&db).await.unwrap();
        db.close().await;
        assert_eq!(fs::read(&archive).unwrap(), archive_before);
        assert_eq!(fs::read(target.join("config.toml")).unwrap(), original_config);
        assert_eq!(InstanceId::load_or_create(test.root.path()).unwrap(), source_instance);
        assert_eq!(InstanceId::load_or_create(&target).unwrap(), target_instance);
    }).await;
}

#[tokio::test]
async fn restore_rejects_untrusted_archive_and_schema() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        let path = input.destination.clone();
        export(input, Arc::new(Cancellation::default()), Arc::new(|_, _, _| {})).await.unwrap();
        let target = output.path().join("target");
        fs::create_dir(&target).unwrap();
        let instance = InstanceId::load_or_create(&target).unwrap();
        for (index, sql) in [
            "UPDATE fw_schema_migration SET version=999 WHERE module='framework' AND version=1",
            "UPDATE fw_schema_migration SET module='unknown' WHERE module='framework'",
            "UPDATE fw_schema_migration SET checksum='wrong' WHERE module='framework'",
            "UPDATE fw_schema_migration SET status='failed' WHERE module='framework'",
            "UPDATE fw_file SET instance_id='0199bca1-1234-7123-8123-abcdef012345'",
            "UPDATE fw_file SET stored_path='../outside'",
            "INSERT INTO fw_job (id,kind,module,status,payload,priority,attempts,max_attempts,retry_safe,cancel_requested,run_after,created_at,updated_at,row_version) VALUES ('pending','disabled.job','disabled','queued','{}',0,0,1,0,0,0,0,0,1)",
        ].iter().enumerate() {
            let operation = output.path().join(format!("bad-{index}"));
            fs::create_dir(&operation).unwrap();
            let cancel = Cancellation::default();
            let (manifest, _) = restore::extract(&path, &operation, "fixture", &cancel).unwrap();
            let stage = operation.join("stage");
            use sqlx::Connection;
            let options = sqlx::sqlite::SqliteConnectOptions::new().filename(stage.join("data/app.db"));
            let mut db = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
            sqlx::query(*sql).execute(&mut db).await.unwrap();
            db.close().await.unwrap();
            let budget = restore::DatabaseBudget::new(Arc::new(cancel), restore::DATABASE_TIMEOUT);
            assert!(restore::prepare_database(&stage, &manifest, crate::migrations::MIGRATIONS, instance, &budget).await.is_err(), "{sql}");
        }
        let operation = output.path().join("wrong-product");
        fs::create_dir(&operation).unwrap();
        assert!(restore::extract(&path, &operation, "different", &Cancellation::default()).is_err());
        // 即使压缩后的条目很小且哈希正确，恢复也不接受压缩包或解压炸弹入口。
        let compressed = output.path().join("compressed.tenon-backup.zip");
        let mut source = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        let mut zip = zip::ZipWriter::new(fs::File::create(&compressed).unwrap());
        for index in 0..source.len() {
            let mut entry = source.by_index(index).unwrap();
            let name = entry.name().unwrap().into_owned();
            zip.start_file(
                name,
                zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            ).unwrap();
            std::io::copy(&mut entry, &mut zip).unwrap();
        }
        zip.finish().unwrap();
        let operation = output.path().join("compressed");
        fs::create_dir(&operation).unwrap();
        assert_eq!(
            restore::extract(&compressed, &operation, "fixture", &Cancellation::default()).err().unwrap().code(),
            INVALID_ARCHIVE,
        );
        drop(source);
        // ZIP 入口复用同一套路径/重复条目/压缩/限额校验；篡改成员须在写入 stage 时发现。
        let mut raw = fs::read(&path).unwrap();
        let sentinel = b"private business content";
        let at = raw.windows(sentinel.len()).position(|bytes| bytes == sentinel).unwrap();
        raw[at] ^= 1;
        fs::write(&path, raw).unwrap();
        let operation = output.path().join("changed");
        fs::create_dir(&operation).unwrap();
        assert!(restore::extract(&path, &operation, "fixture", &Cancellation::default()).is_err());
    }).await;
}

#[tokio::test]
async fn restore_rejects_executable_and_foreign_schema_before_writes() {
    use sqlx::Connection;
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        let instance = input.files.instance_id();
        let archive = input.destination.clone();
        export(input, Arc::new(Cancellation::default()), Arc::new(|_, _, _| {})).await.unwrap();
        for (index, sql) in [
            "CREATE TRIGGER restore_marker AFTER UPDATE OF instance_id ON fw_file BEGIN INSERT INTO fw_param (id,param_key,value,secret_set,created_at,updated_at,row_version,created_by,updated_by) VALUES ('marker','fixture.marker','executed',0,0,0,1,'fixture','fixture'); END",
            "CREATE VIEW restore_view AS SELECT * FROM fw_file",
            "CREATE VIRTUAL TABLE restore_virtual USING fts5(content)",
            "ALTER TABLE fw_param ADD COLUMN generated_value TEXT GENERATED ALWAYS AS (param_key) VIRTUAL",
            "CREATE TABLE restore_stored (value TEXT, generated_value TEXT GENERATED ALWAYS AS (value) STORED)",
            "CREATE TABLE restore_unknown (value TEXT)",
            "CREATE INDEX restore_unknown ON fw_file (instance_id)",
            "DROP INDEX ux_fw_param_key",
        ].iter().enumerate() {
            let operation = output.path().join(format!("schema-{index}"));
            fs::create_dir(&operation).unwrap();
            let cancel = Cancellation::default();
            let (manifest, _) = restore::extract(&archive, &operation, "fixture", &cancel).unwrap();
            let stage = operation.join("stage");
            let options = sqlx::sqlite::SqliteConnectOptions::new().filename(stage.join("data/app.db"));
            let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
            sqlx::raw_sql(sqlx::AssertSqlSafe(*sql)).execute(&mut connection).await.unwrap();
            connection.close().await.unwrap();
            let budget = restore::DatabaseBudget::new(Arc::new(cancel), restore::DATABASE_TIMEOUT);
            let result = restore::prepare_database(&stage, &manifest, crate::migrations::MIGRATIONS, instance, &budget).await;
            let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
            let markers: i64 = sqlx::query_scalar("SELECT count(*) FROM fw_param WHERE param_key='fixture.marker'")
                .fetch_one(&mut connection).await.unwrap();
            connection.close().await.unwrap();
            assert_eq!(markers, 0, "trigger must never run: {sql}");
            assert_eq!(result.unwrap_err().code(), INVALID_ARCHIVE, "{sql}");
        }
    }).await;
}

#[tokio::test]
async fn restore_clears_all_secret_bindings() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        test.raw("INSERT INTO fw_param (id,param_key,value,secret_set,created_at,updated_at,row_version,created_by,updated_by) VALUES ('ai','ai.api_key',NULL,1,0,0,1,'fixture','fixture'),('other','fixture.secret',NULL,1,0,0,1,'fixture','fixture'),('noncanonical','fixture.noncanonical',NULL,2,0,0,1,'fixture','fixture')").await;
        let instance = input.files.instance_id();
        let archive = input.destination.clone();
        export(input, Arc::new(Cancellation::default()), Arc::new(|_, _, _| {})).await.unwrap();
        let operation = output.path().join("secrets");
        fs::create_dir(&operation).unwrap();
        let cancel = Cancellation::default();
        let (manifest, _) = restore::extract(&archive, &operation, "fixture", &cancel).unwrap();
        let stage = operation.join("stage");
        let budget = restore::DatabaseBudget::new(Arc::new(cancel), restore::DATABASE_TIMEOUT);
        assert!(!restore::prepare_database(&stage, &manifest, crate::migrations::MIGRATIONS, instance, &budget).await.unwrap());
        let db = crate::db::Db::open_sqlite(stage.join("data/app.db")).await.unwrap();
        let bindings: Vec<(bool,)> = db.fetch_all(&sea_query::Query::select().column("secret_set").from("fw_param").to_owned()).await.unwrap();
        assert_eq!(bindings, [(false,), (false,), (false,)]);
        db.close().await;
    }).await;
}

#[tokio::test]
async fn restore_rejects_changed_definitions_with_identical_object_names() {
    use sqlx::Connection;
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        let instance = input.files.instance_id();
        let archive = input.destination.clone();
        export(
            input,
            Arc::new(Cancellation::default()),
            Arc::new(|_, _, _| {}),
        )
        .await
        .unwrap();
        let mut accepted = Vec::new();
        for (case, name) in [
            ("check", "fw_file"),
            ("default", "fw_file"),
            ("index_columns", "ix_fw_file_purpose"),
            ("index_where", "ix_fw_file_purpose"),
            ("migration_check", "fw_schema_migration"),
        ] {
            let operation = output.path().join(case);
            fs::create_dir(&operation).unwrap();
            let cancel = Cancellation::default();
            let (manifest, _) = restore::extract(&archive, &operation, "fixture", &cancel).unwrap();
            let stage = operation.join("stage");
            let options =
                sqlx::sqlite::SqliteConnectOptions::new().filename(stage.join("data/app.db"));
            let mut connection = sqlx::SqliteConnection::connect_with(&options)
                .await
                .unwrap();
            let names_before: Vec<(String, String)> =
                sqlx::query_as("SELECT type, name FROM sqlite_schema ORDER BY type, name")
                    .fetch_all(&mut connection)
                    .await
                    .unwrap();
            let original: String =
                sqlx::query_scalar("SELECT sql FROM sqlite_schema WHERE name = ?")
                    .bind(name)
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            let modified = match case {
                "check" | "migration_check" => format!(
                    "{}, CHECK (length(hex(zeroblob(8))) > 0))",
                    original.strip_suffix(')').unwrap()
                ),
                "default" => original.replace(
                    "\"original_name\" varchar(255) NOT NULL",
                    "\"original_name\" varchar(255) NOT NULL DEFAULT (hex(zeroblob(8)))",
                ),
                "index_columns" => original.replace("(\"purpose\")", "(\"instance_id\")"),
                "index_where" => format!("{original} WHERE purpose <> ''"),
                _ => panic!("unexpected test case"),
            };
            assert_ne!(modified, original, "fixture must change the DDL");
            println!("{case}:\noriginal: {original}\nmodified: {modified}");
            if case.starts_with("index_") {
                sqlx::query("DROP INDEX ix_fw_file_purpose")
                    .execute(&mut connection)
                    .await
                    .unwrap();
                sqlx::raw_sql(sqlx::AssertSqlSafe(modified.as_str()))
                    .execute(&mut connection)
                    .await
                    .unwrap();
            } else {
                // 仅改测试库的约束/默认值文本；列及已有记录不变，仅使用 8 字节的 zeroblob。
                sqlx::query("PRAGMA writable_schema = ON")
                    .execute(&mut connection)
                    .await
                    .unwrap();
                sqlx::query("UPDATE sqlite_schema SET sql = ? WHERE name = ?")
                    .bind(&modified)
                    .bind(name)
                    .execute(&mut connection)
                    .await
                    .unwrap();
                sqlx::query("PRAGMA writable_schema = OFF")
                    .execute(&mut connection)
                    .await
                    .unwrap();
            }
            let names_after: Vec<(String, String)> =
                sqlx::query_as("SELECT type, name FROM sqlite_schema ORDER BY type, name")
                    .fetch_all(&mut connection)
                    .await
                    .unwrap();
            assert_eq!(
                names_after, names_before,
                "all object names must remain unchanged"
            );
            connection.close().await.unwrap();
            let budget = restore::DatabaseBudget::new(Arc::new(cancel), restore::DATABASE_TIMEOUT);
            match restore::prepare_database(
                &stage,
                &manifest,
                crate::migrations::MIGRATIONS,
                instance,
                &budget,
            )
            .await
            {
                Ok(_) => accepted.push(case),
                Err(error) => assert_eq!(error.code(), INVALID_ARCHIVE, "{case}"),
            }
        }
        assert!(
            accepted.is_empty(),
            "accepted modified schema definitions: {accepted:?}"
        );
    })
    .await;
}

#[tokio::test]
async fn restore_rejects_extra_reserved_name_index() {
    assert_reserved_object_rejected(
        "index",
        "sqlite_fixture_extra",
        "CREATE UNIQUE INDEX tmp ON fw_job(kind)",
    )
    .await;
}

#[tokio::test]
async fn restore_rejects_extra_reserved_name_table() {
    assert_reserved_object_rejected(
        "table",
        "sqlite_fixture_table",
        "CREATE TABLE tmp (value TEXT CHECK (length(hex(zeroblob(8))) > 0)); INSERT INTO tmp VALUES ('fixture')",
    )
    .await;
}

async fn assert_reserved_object_rejected(kind: &str, name: &str, sql: &str) {
    use sqlx::Connection;
    test_support::run_on(Dialect::Sqlite, async |test| {
        let output = workspace();
        let input = setup(test, output.path()).await;
        let instance = input.files.instance_id();
        let active_files = test.rows::<(String, String)>("fw_file", &["stored_path", "instance_id"]).await;
        let active_config = fs::read(test.root.path().join("config.toml")).unwrap();
        let archive = input.destination.clone();
        export(input, Arc::new(Cancellation::default()), Arc::new(|_, _, _| {})).await.unwrap();
        let archive_before = fs::read(&archive).unwrap();
        let operation = output.path().join("reserved-schema");
        fs::create_dir(&operation).unwrap();
        let cancel = Arc::new(Cancellation::default());
        let (manifest, _) = restore::extract(&archive, &operation, "fixture", &cancel).unwrap();
        let stage = operation.join("stage");
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(stage.join("data/app.db"));
        let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(sqlx::AssertSqlSafe(sql)).execute(&mut connection).await.unwrap();
        let original: String = sqlx::query_scalar("SELECT sql FROM sqlite_schema WHERE name = 'tmp'")
            .fetch_one(&mut connection).await.unwrap();
        sqlx::query("PRAGMA writable_schema = ON").execute(&mut connection).await.unwrap();
        // 表还须同步 tbl_name；索引的 tbl_name 仍为 fw_job，符合 SQLite 重载时的核验。
        sqlx::query("UPDATE sqlite_schema SET name = ?, tbl_name = REPLACE(tbl_name, 'tmp', ?), sql = REPLACE(sql, 'tmp', ?) WHERE name = 'tmp'")
            .bind(name).bind(name).bind(name).execute(&mut connection).await.unwrap();
        sqlx::query("PRAGMA writable_schema = OFF").execute(&mut connection).await.unwrap();
        connection.close().await.unwrap();

        // 新连接必须解析并装载保留名对象，不能只在旧连接里看到被改写的 schema 行。
        let mut connection = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        let object: (String, String) = sqlx::query_as("SELECT type, sql FROM sqlite_schema WHERE name = ?")
            .bind(name).fetch_one(&mut connection).await.unwrap();
        assert_eq!(object, (kind.to_owned(), original.replace("tmp", name)));
        let loaded: String = sqlx::query_scalar(match kind {
            "index" => "SELECT name FROM pragma_index_list('fw_job') WHERE name = ? AND \"unique\" = 1",
            "table" => "SELECT name FROM pragma_table_list WHERE name = ? AND type = 'table'",
            _ => panic!("unexpected test case"),
        }).bind(name).fetch_one(&mut connection).await.unwrap();
        assert_eq!(loaded, name);
        if kind == "table" {
            let columns: Vec<(String, i64)> = sqlx::query_as("SELECT name, hidden FROM pragma_table_xinfo(?)")
                .bind(name).fetch_all(&mut connection).await.unwrap();
            assert_eq!(columns, [("value".into(), 0)]);
            let value: String = sqlx::query_scalar("SELECT value FROM sqlite_fixture_table")
                .fetch_one(&mut connection).await.unwrap();
            assert_eq!(value, "fixture");
        }
        // 夹具检查可安全求值 8 字节 CHECK；quick_check 本身不会拒绝这些额外对象。
        let integrity: Vec<String> = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_all(&mut connection).await.unwrap();
        assert_eq!(integrity, ["ok"]);
        connection.close().await.unwrap();

        let stage_before = restore::stage_digests(&stage, &cancel).unwrap();
        let budget = restore::DatabaseBudget::new(cancel.clone(), restore::DATABASE_TIMEOUT);
        let error = restore::prepare_database(
            &stage, &manifest, crate::migrations::MIGRATIONS, instance, &budget,
        ).await.expect_err("extra reserved-name schema object must be rejected");
        assert_eq!(error.code(), INVALID_ARCHIVE);
        assert_eq!(restore::stage_digests(&stage, &cancel).unwrap(), stage_before);
        assert_eq!(fs::read(&archive).unwrap(), archive_before);
        assert_eq!(test.rows::<(String, String)>("fw_file", &["stored_path", "instance_id"]).await, active_files);
        assert_eq!(fs::read(test.root.path().join("config.toml")).unwrap(), active_config);
        assert_eq!(InstanceId::load_or_create(test.root.path()).unwrap(), instance);
    }).await;
}

#[tokio::test]
async fn restore_connection_interrupts_running_sql_on_deadline_and_cancel() {
    use crate::db::Db;
    use std::time::{Duration, Instant};
    for cancel_during_query in [false, true] {
        let root = workspace();
        let path = root.path().join("budget.db");
        Db::open_sqlite(&path).await.unwrap().close().await;
        let cancellation = Arc::new(Cancellation::default());
        let budget = restore::DatabaseBudget::new(
            cancellation.clone(),
            if cancel_during_query {
                restore::DATABASE_TIMEOUT
            } else {
                Duration::from_millis(100)
            },
        );
        let db = restore::open_sqlite(&path, budget.clone()).await.unwrap();
        let trusted: Option<(i64,)> = db
            .fetch_optional(
                &sea_query::Query::select()
                    .column("trusted_schema")
                    .from("pragma_trusted_schema")
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(trusted, Some((0,)));
        let query = sea_query::Query::select().expr(sea_query::Expr::cust(
            "(WITH RECURSIVE count(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM count WHERE n<100000000) SELECT sum(n) FROM count)"
        )).to_owned();
        let started = Instant::now();
        let (result, ()) = tokio::join!(db.fetch_optional::<(i64,)>(&query), async {
            if cancel_during_query {
                tokio::time::sleep(Duration::from_millis(25)).await;
                cancellation.cancel();
            }
        });
        assert!(
            result.is_err(),
            "finite query must be interrupted, not completed"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(
            budget.check().unwrap_err().code(),
            if cancel_during_query {
                CANCELLED
            } else {
                RESTORE_FAILED
            }
        );
        db.close().await;
    }
}
