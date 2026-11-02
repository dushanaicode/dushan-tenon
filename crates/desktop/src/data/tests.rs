//! 无宿主运行时的会话、取消及归档交接回归；真实业务校验由宿主测试装配。

use super::*;
use std::{
    num::NonZeroUsize,
    sync::atomic::{AtomicBool, Ordering},
};
use tenon_framework::{actor::Actor, db::migrate, id::Id, migrations::MIGRATIONS};

struct Fixture {
    temporary: tempfile::TempDir,
    data: Arc<DataService>,
    files: FileStore,
    instance: InstanceId,
    owner: StreamOwner,
}

impl Fixture {
    async fn new() -> Self {
        let temporary =
            tempfile::tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP")).unwrap();
        let root = temporary.path().join("state");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::create_dir_all(root.join("files")).unwrap();
        let db = Db::open_sqlite(crate::database::path(&root)).await.unwrap();
        migrate::startup(&db, MIGRATIONS, &root, NonZeroUsize::MIN)
            .await
            .unwrap();
        let instance = InstanceId::load_or_create(&root).unwrap();
        let files = FileStore::new(db.clone(), &root, instance, 20, &[]);
        let data = Arc::new(DataService::new(
            db,
            root.clone(),
            root.join("Temp/backup"),
            root.join("Temp/restore"),
        ));
        let owner = StreamOwner {
            actor: Actor::User(Id::new()),
            scope: "main".into(),
        };
        Self {
            temporary,
            data,
            files,
            instance,
            owner,
        }
    }

    fn config(&self) -> LoadedConfig {
        config::load(&self.data.root, [], &[]).unwrap()
    }

    fn target<'a>(&self, config: &'a LoadedConfig) -> RestoreTarget<'a> {
        RestoreTarget {
            owner: self.owner.clone(),
            config,
            instance: self.instance,
        }
    }

    fn export_input(&self) -> ExportInput {
        ExportInput {
            destination: self.temporary.path().join("copy.tenon-backup.zip"),
            files: self.files.clone(),
            product_id: "com.dushan.tenon".into(),
            migrations: MIGRATIONS.to_vec(),
        }
    }

    fn restore_input(&self) -> RestoreInput {
        RestoreInput {
            selected: self.export_input().destination,
            product_id: "com.dushan.tenon".into(),
            migrations: MIGRATIONS.to_vec(),
        }
    }

    async fn archive(&self) {
        self.data
            .export(self.export_input(), Arc::new(|_| {}))
            .await
            .unwrap();
    }

    async fn prepare(&self) -> RestorePlan {
        self.data
            .prepare_restore(
                self.target(&self.config()),
                self.restore_input(),
                Arc::new(|_| {}),
                |_| Ok(()),
                async |_| Ok(()),
            )
            .await
            .unwrap()
    }

    fn stage(&self) -> PathBuf {
        self.data
            .prepared
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .directory
            .path()
            .join("stage")
    }
}

#[tokio::test]
async fn prepared_token_binds_actor_main_root_config_expiry_and_single_use() {
    for case in [
        "valid", "actor", "scope", "id", "root", "config", "expired", "instance",
    ] {
        let fixture = Fixture::new().await;
        let data = &fixture.data;
        let config = fixture.config();
        let id = operation_id();
        let directory = tempfile::tempdir_in(fixture.temporary.path()).unwrap();
        let directory_path = directory.path().to_owned();
        *data.prepared.lock().unwrap() = Some(Prepared {
            id: id.clone(),
            owner: fixture.owner.clone(),
            expires: if case == "expired" {
                Instant::now() - Duration::from_secs(1)
            } else {
                Instant::now() + Duration::from_secs(600)
            },
            directory,
            root: if case == "root" {
                "changed".into()
            } else {
                restore::path_digest(&data.root).unwrap()
            },
            instance: fixture.instance,
            config: None,
            archive: staging::Digest {
                bytes: 0,
                sha256: String::new(),
            },
            members: BTreeMap::new(),
        });
        let mut target = fixture.target(&config);
        if case == "actor" {
            target.owner.actor = Actor::User(Id::new());
        }
        if case == "scope" {
            target.owner.scope = "other".into();
        }
        if case == "instance" {
            target.instance = InstanceId::load_or_create(fixture.temporary.path()).unwrap();
        }
        if case == "config" {
            fs::write(data.root.join("config.toml"), "[ui]\ntheme='dark'").unwrap();
        }
        let requested = if case == "id" { operation_id() } else { id };
        let result = data.consume_prepared(&target, &requested);
        if case == "valid" {
            drop(result.unwrap());
        } else {
            assert_eq!(
                result.err().unwrap().code(),
                backup::RESTORE_EXPIRED,
                "{case}"
            );
        }
        assert!(!directory_path.exists());
        assert_eq!(
            data.consume_prepared(&target, &requested)
                .err()
                .unwrap()
                .code(),
            backup::RESTORE_EXPIRED
        );
        data.db.close().await;
    }
}

#[tokio::test]
async fn cancel_tokens_are_random_bounded_and_idempotent() {
    let fixture = Fixture::new().await;
    let data = &fixture.data;
    let a = operation_id();
    let b = operation_id();
    assert_ne!(a, b);
    for id in [&a, &b] {
        validate_operation_id(id).unwrap();
    }
    data.cancel(&a).unwrap();
    let registration = data.register().unwrap();
    let op = &registration.operation;
    data.cancel(&b).unwrap();
    op.cancellation.check().unwrap();
    data.cancel(&op.id).unwrap();
    data.cancel(&op.id).unwrap();
    assert_eq!(
        op.cancellation.check().unwrap_err().code(),
        backup::CANCELLED
    );
    let id = op.id.clone();
    drop(registration);
    data.cancel(&id).unwrap();
    for invalid in [
        "../invalid",
        "",
        "0123456789ABCDEF0123456789ABCDEF",
        "0123456789abcdef0123456789abcdef0",
    ] {
        assert_eq!(data.cancel(invalid).unwrap_err().code(), INPUT_INVALID);
    }
    data.db.close().await;
}

#[tokio::test]
async fn operation_slot_is_exclusive_until_last_worker_releases_it() {
    let fixture = Fixture::new().await;
    let data = &fixture.data;
    let registration = data.register().unwrap();
    let worker = registration.clone();
    drop(registration);
    assert_eq!(data.register().err().unwrap().code(), OPERATION_BUSY);
    let op = worker.operation.clone();
    op.cancellation.commit().unwrap();
    data.cancel(&op.id).unwrap();
    op.cancellation.check().unwrap();
    assert!(!op.cancellation.can_cancel());
    let status = serde_json::to_string(&data.status(true, &fixture.config()).unwrap()).unwrap();
    assert!(!status.contains(&op.id));
    assert!(!status.contains("operationId"));
    drop(worker);
    drop(data.register().unwrap());
    assert!(data.operation.lock().unwrap().is_none());
    data.db.close().await;
}

#[tokio::test]
async fn backup_cancellation_preserves_destination_at_each_phase() {
    for phase in [
        OperationPhase::Preparing,
        OperationPhase::Snapshotting,
        OperationPhase::Copying,
        OperationPhase::Verifying,
        OperationPhase::Archiving,
    ] {
        let fixture = Fixture::new().await;
        let input = fixture.export_input();
        fs::write(&input.destination, b"previous archive").unwrap();
        let path = input.destination.clone();
        let data = fixture.data.clone();
        let observed = Arc::new(AtomicBool::new(false));
        let signal = observed.clone();
        let observer = Arc::new(move |progress: OperationProgress| {
            // 同步回调可重入 status/cancel，不持操作或进度锁。
            let config = config::load(&data.root, [], &[]).unwrap();
            let status = serde_json::to_string(&data.status(true, &config).unwrap()).unwrap();
            assert!(!status.contains(&progress.operation_id));
            if std::mem::discriminant(&progress.phase) == std::mem::discriminant(&phase) {
                signal.store(true, Ordering::Release);
                data.cancel(&progress.operation_id).unwrap();
            }
        });
        assert_eq!(
            fixture
                .data
                .export(input, observer)
                .await
                .err()
                .unwrap()
                .code(),
            backup::CANCELLED
        );
        assert!(observed.load(Ordering::Acquire));
        assert_eq!(fs::read(path).unwrap(), b"previous archive");
        assert!(fixture.data.operation.lock().unwrap().is_none());
        fixture.data.db.close().await;
    }
}

#[tokio::test]
async fn prepared_rechecks_archive_projection_database_and_merged_config() {
    for name in [
        "archive.zip",
        "stage/data/app.db",
        "stage/config.json",
        "stage/config.toml",
        "expired",
        "config",
    ] {
        let fixture = Fixture::new().await;
        fixture.archive().await;
        let plan = fixture.prepare().await;
        {
            let mut prepared = fixture.data.prepared.lock().unwrap();
            let prepared = prepared.as_mut().unwrap();
            match name {
                "expired" => prepared.expires = Instant::now() - Duration::from_secs(1),
                "config" => {
                    fs::write(fixture.data.root.join("config.toml"), "[ui]\ntheme='dark'").unwrap()
                }
                _ => fs::write(prepared.directory.path().join(name), b"tampered").unwrap(),
            }
        }
        let closed = AtomicBool::new(false);
        let config = fixture.config();
        let error = fixture
            .data
            .commit_restore(fixture.target(&config), &plan.prepared_id, || {
                closed.store(true, Ordering::Release)
            })
            .await
            .err()
            .unwrap();
        assert_eq!(
            error.code(),
            if matches!(name, "expired" | "config") {
                backup::RESTORE_EXPIRED
            } else {
                backup::HASH_MISMATCH
            },
            "{name}"
        );
        assert!(!closed.load(Ordering::Acquire));
        assert!(!fixture.data.root.join("restore-journal.json").exists());
        assert!(crate::database::path(&fixture.data.root).is_file());
        assert!(fixture.data.prepared.lock().unwrap().is_none());
        fixture.data.db.close().await;
    }
}

#[tokio::test]
async fn restore_handoff_preserves_device_fields_and_defers_replacement_until_restart() {
    let fixture = Fixture::new().await;
    fs::write(
        fixture.data.root.join("config.toml"),
        "[ui]\ntheme='dark'\ndeveloper_mode=true\n[notify]\ndesktop=false\n",
    )
    .unwrap();
    fixture.archive().await;
    let target_text = "# target device\n[ui]\ntheme='light'\ndeveloper_mode=false\n[window]\ntitlebar='hidden'\n[network]\nproxy_endpoint='https://target.invalid'\n";
    fs::write(fixture.data.root.join("config.toml"), target_text).unwrap();
    let config_checked = AtomicBool::new(false);
    let modules_checked = AtomicBool::new(false);
    let config = fixture.config();
    let plan = fixture
        .data
        .prepare_restore(
            fixture.target(&config),
            fixture.restore_input(),
            Arc::new(|_| {}),
            |merged| {
                assert_eq!(merged.settings().theme.value, config::Theme::Dark);
                assert!(!merged.settings().developer_mode.value);
                config_checked.store(true, Ordering::Release);
                Ok(())
            },
            async |db| {
                assert!(config_checked.load(Ordering::Acquire));
                assert_eq!(db.dialect(), Dialect::Sqlite);
                modules_checked.store(true, Ordering::Release);
                Ok(())
            },
        )
        .await
        .unwrap();
    assert!(modules_checked.load(Ordering::Acquire));
    assert!(!fixture.data.root.join("restore-journal.json").exists());
    let staged = fs::read_to_string(fixture.stage().join("config.toml")).unwrap();
    assert!(staged.contains("https://target.invalid"));
    assert!(staged.contains("titlebar='hidden'"));
    assert_eq!(
        fs::read_to_string(fixture.data.root.join("config.toml")).unwrap(),
        target_text
    );
    let closed = AtomicBool::new(false);
    let accepted = fixture
        .data
        .commit_restore(fixture.target(&config), &plan.prepared_id, || {
            assert!(fixture.data.root.join("restore-journal.json").is_file());
            closed.store(true, Ordering::Release);
        })
        .await
        .unwrap();
    assert!(accepted.restart_required && closed.load(Ordering::Acquire));
    assert_eq!(
        fs::read_to_string(fixture.data.root.join("config.toml")).unwrap(),
        target_text
    );
    fixture.data.db.close().await;
    restore::before_start(
        &fixture.data.root,
        &fixture.data.restore_scratch,
        Some(&accepted.operation_id),
    )
    .unwrap();
    assert_eq!(
        restore::last_result(&fixture.data.root)
            .unwrap()
            .unwrap()
            .status,
        restore::RestoreStatus::Succeeded
    );
    let restored = fixture.config();
    assert_eq!(restored.settings().theme.value, config::Theme::Dark);
    assert!(!restored.settings().developer_mode.value);
    assert!(!restored.notify().desktop);
    assert_eq!(
        InstanceId::load_or_create(&fixture.data.root).unwrap(),
        fixture.instance
    );
}

#[tokio::test]
async fn failed_module_callbacks_cancel_prepare_without_touching_live_data() {
    let fixture = Fixture::new().await;
    fixture.archive().await;
    for reject_config in [true, false] {
        let called = AtomicBool::new(false);
        let error = fixture
            .data
            .prepare_restore(
                fixture.target(&fixture.config()),
                fixture.restore_input(),
                Arc::new(|_| {}),
                |_| {
                    if reject_config {
                        Err(AppError::new(backup::INVALID_ARCHIVE))
                    } else {
                        Ok(())
                    }
                },
                async |_| {
                    called.store(true, Ordering::Release);
                    Err(AppError::new(backup::INVALID_ARCHIVE))
                },
            )
            .await
            .err()
            .unwrap();
        assert_eq!(error.code(), backup::INVALID_ARCHIVE);
        assert_eq!(called.load(Ordering::Acquire), !reject_config);
        assert!(fixture.data.prepared.lock().unwrap().is_none());
        assert!(fixture.data.operation.lock().unwrap().is_none());
        assert!(!fixture.data.root.join("restore-journal.json").exists());
    }
    fixture.data.db.close().await;
}

#[tokio::test]
async fn restore_rejects_overrides_wrong_scope_and_instance() {
    let fixture = Fixture::new().await;
    for (key, value, rejected) in [
        ("ui.theme", "dark", true),
        ("jobs.max_concurrency", "8", true),
        ("database.backup_keep", "7", true),
        ("ui.developer_mode", "true", false),
        ("window.titlebar", "hidden", false),
    ] {
        for environment in [false, true] {
            let config = if environment {
                config::load(
                    &fixture.data.root,
                    [(
                        format!("TENON__{}", key.to_uppercase().replace('.', "__")),
                        value.into(),
                    )],
                    &[],
                )
                .unwrap()
            } else {
                config::load(&fixture.data.root, [], &[format!("{key}={value}")]).unwrap()
            };
            let result = fixture.data.check_restore_target(&fixture.target(&config));
            if rejected {
                assert_eq!(result.unwrap_err().code(), config::SETTINGS_OVERRIDDEN);
            } else {
                result.unwrap();
            }
        }
    }
    let config = fixture.config();
    let mut target = fixture.target(&config);
    target.owner.scope = "other".into();
    assert_eq!(
        fixture
            .data
            .check_restore_target(&target)
            .unwrap_err()
            .code(),
        PERMISSION_DENIED
    );
    target.owner.scope = "main".into();
    fs::write(fixture.data.root.join("instance-id"), "changed").unwrap();
    assert_eq!(
        fixture
            .data
            .check_restore_target(&target)
            .unwrap_err()
            .code(),
        backup::RESTORE_FAILED
    );
    fixture.data.db.close().await;
}

#[tokio::test]
async fn cancelled_prepare_and_replacement_release_old_session() {
    let fixture = Fixture::new().await;
    fixture.archive().await;
    let first = fixture.prepare().await;
    let old = fixture.stage().parent().unwrap().to_owned();
    let second = fixture.prepare().await;
    assert_ne!(first.prepared_id, second.prepared_id);
    assert!(!old.exists());
    let data = fixture.data.clone();
    let result = fixture
        .data
        .prepare_restore(
            fixture.target(&fixture.config()),
            fixture.restore_input(),
            Arc::new(move |progress| {
                data.cancel(&progress.operation_id).unwrap();
            }),
            |_| Ok(()),
            async |_| Ok(()),
        )
        .await;
    assert_eq!(result.err().unwrap().code(), backup::CANCELLED);
    assert!(fixture.data.prepared.lock().unwrap().is_none());
    assert!(fixture.data.operation.lock().unwrap().is_none());
    fixture.data.db.close().await;
}

#[tokio::test]
async fn poisoned_operation_lock_is_reported_and_cleanup_does_not_panic() {
    let fixture = Fixture::new().await;
    let registration = fixture.data.register().unwrap();
    let active = fixture.data.operation.clone();
    assert!(
        std::thread::spawn(move || {
            let _guard = active.lock().unwrap();
            panic!("poison fixture");
        })
        .join()
        .is_err()
    );
    assert_eq!(
        fixture
            .data
            .cancel(&registration.operation.id)
            .unwrap_err()
            .code(),
        INTERNAL_UNEXPECTED
    );
    drop(registration);
    assert!(
        fixture
            .data
            .operation
            .lock()
            .err()
            .unwrap()
            .into_inner()
            .is_none()
    );
    fixture.data.db.close().await;
}
