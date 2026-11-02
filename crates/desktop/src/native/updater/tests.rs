//! 更新状态机回归；所有下载和安装均为替身。

use super::*;
use tenon_framework::{
    actor::Actor,
    id::Id,
    maintenance::OperationGate,
    stream::{StreamEvent, StreamRegistry, StreamSink},
};

#[derive(Default)]
struct FakeDriver {
    events: Mutex<Vec<&'static str>>,
    wait: bool,
    check_wait: bool,
    download_error: Option<ErrorCode>,
    reported_length: Option<usize>,
    reported_total: Option<u64>,
}

impl UpdateDriver for FakeDriver {
    fn check(&self, _: Arc<ProxySnapshot>, _: PathBuf) -> UpdateFuture<'_, Option<ReleaseInfo>> {
        Box::pin(async {
            self.events.lock().unwrap().push("check");
            if self.check_wait {
                std::future::pending::<()>().await;
            }
            Ok(Some(ReleaseInfo {
                version: "0.2.0".into(),
                published_at: None,
                notes: "<b>plain text</b>".into(),
            }))
        })
    }
    fn download(&self, progress: DownloadProgress) -> UpdateFuture<'_, Vec<u8>> {
        Box::pin(async move {
            self.events.lock().unwrap().push("download");
            if self.wait {
                std::future::pending::<()>().await;
            }
            progress(self.reported_length.unwrap_or(3), self.reported_total);
            if let Some(error) = self.download_error {
                return Err(AppError::new(error));
            }
            Ok(b"MZfixture".to_vec())
        })
    }
    fn install(&self, _: Vec<u8>) -> Result<(), AppError> {
        self.events.lock().unwrap().push("installer");
        Err(AppError::new(INSTALL_FAILED))
    }
}

#[tokio::test]
async fn dropped_check_and_download_release_their_operation_state() {
    let root = root();
    let checking = Updater::new(
        Some(Arc::new(FakeDriver {
            check_wait: true,
            ..Default::default()
        })),
        root.path().join("checking"),
    );
    let mut check = Box::pin(checking.check(owner(), || Ok(Arc::new(ProxySnapshot::Direct)), "t"));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), &mut check)
            .await
            .is_err()
    );
    drop(check);
    assert!(matches!(checking.status().unwrap(), UpdateState::Idle));
    let downloading = Updater::new(
        Some(Arc::new(FakeDriver {
            wait: true,
            ..Default::default()
        })),
        root.path().join("downloading"),
    );
    let owner = owner();
    let id = available(&downloading, &owner).await;
    let (stream, progress) = stream(&owner);
    let mut download =
        Box::pin(downloading.download(owner, UpdateDownloadInput { update_id: id }, stream, "t"));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), &mut download)
            .await
            .is_err()
    );
    let token = progress.lock().unwrap()[0].operation_id.clone();
    drop(download);
    assert!(matches!(
        downloading.status().unwrap(),
        UpdateState::Available { .. }
    ));
    assert!(downloading.download.lock().unwrap().is_none());
    downloading.cancel(&token).unwrap();
    assert!(matches!(
        downloading.status().unwrap(),
        UpdateState::Available { .. }
    ));
}

struct Sink(Arc<Mutex<Vec<OperationProgress>>>);
impl StreamSink<OperationProgress> for Sink {
    fn send(&self, event: StreamEvent<OperationProgress>) -> Result<(), AppError> {
        if let StreamEvent::Delta { data, .. } = event {
            self.0.lock().unwrap().push(data);
        }
        Ok(())
    }
}
fn owner() -> StreamOwner {
    StreamOwner {
        actor: Actor::User(Id::new()),
        scope: "main".into(),
    }
}
fn root() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn scratch_uses_injected_absolute_path_and_rejects_files_and_relative_paths() {
    let root = root();
    let state = root.path().join("state");
    std::fs::create_dir(&state).unwrap();
    let injected = state.join("Temp/updates");
    let operation = scratch(&injected, "operation").unwrap();
    assert_eq!(operation.path().parent(), Some(injected.as_path()));
    assert!(scratch(Path::new("Temp/updates"), "operation").is_err());
    std::fs::write(state.join("file"), b"file").unwrap();
    assert!(scratch(&state.join("file/updates"), "operation").is_err());
}

#[cfg(unix)]
#[test]
fn scratch_rejects_linked_ancestors_before_creating_operation() {
    let root = root();
    let actual = root.path().join("actual");
    std::fs::create_dir(&actual).unwrap();
    let linked = root.path().join("linked");
    std::os::unix::fs::symlink(&actual, &linked).unwrap();
    assert!(scratch(&linked.join("Temp/updates"), "operation").is_err());
    assert!(!actual.join("Temp").exists());
}
fn stream(
    owner: &StreamOwner,
) -> (
    Arc<Stream<OperationProgress>>,
    Arc<Mutex<Vec<OperationProgress>>>,
) {
    let values = Arc::new(Mutex::new(vec![]));
    (
        Arc::new(
            StreamRegistry::default()
                .open(owner.clone(), Sink(values.clone()))
                .unwrap(),
        ),
        values,
    )
}
async fn available(service: &Updater, owner: &StreamOwner) -> String {
    let UpdateState::Available { release } = service
        .check(
            owner.clone(),
            || Ok(Arc::new(ProxySnapshot::Direct)),
            "check",
        )
        .await
        .unwrap()
    else {
        panic!("expected available release");
    };
    release.update_id
}

#[tokio::test]
async fn unconfigured_has_no_entry_or_network() {
    let root = root();
    let updater = Updater::new(None, root.path().join("updates"));
    assert!(matches!(
        updater.status().unwrap(),
        UpdateState::Unconfigured
    ));
    assert_eq!(
        updater
            .check(
                owner(),
                || panic!("unconfigured must not read a proxy snapshot"),
                "test"
            )
            .await
            .err()
            .unwrap()
            .code(),
        UNCONFIGURED
    );
    assert!(!root.path().join("updates").exists());
    let config = Mutex::new(crate::config::load(root.path(), [], &[]).unwrap());
    let change = serde_json::from_value(serde_json::json!({"checkOnStart":true})).unwrap();
    assert_eq!(
        updater
            .update_settings(&config, root.path(), &change)
            .unwrap_err()
            .code(),
        UNCONFIGURED
    );
    assert!(
        !config
            .lock()
            .unwrap()
            .native_settings()
            .check_on_start
            .value
    );
    assert!(!root.path().join("config.toml").exists());
    updater.cancel(&"0".repeat(32)).unwrap();
}

#[tokio::test]
async fn proxy_snapshot_failure_remains_visible_without_network() {
    let root = root();
    let driver = Arc::new(FakeDriver::default());
    let updater = Updater::new(Some(driver.clone()), root.path().join("updates"));
    let error = updater
        .check(
            owner(),
            || Err(AppError::new(tenon_framework::network::CREDENTIALS_MISSING)),
            "snapshot-failed",
        )
        .await
        .err()
        .unwrap();
    assert_eq!(error.code(), tenon_framework::network::CREDENTIALS_MISSING);
    let UpdateState::Failed { error } = updater.status().unwrap() else {
        panic!("expected failed state")
    };
    assert_eq!(error.code, "app.network.credentials_missing");
    assert_eq!(error.trace_id, "snapshot-failed");
    assert!(driver.events.lock().unwrap().is_empty());
    assert!(!root.path().join("updates").exists());
}

#[tokio::test]
async fn changed_artifact_is_rejected_before_shutdown() {
    let root = root();
    let driver = Arc::new(FakeDriver::default());
    let updater = Updater::new(Some(driver.clone()), root.path().join("updates"));
    let owner = owner();
    let id = available(&updater, &owner).await;
    let (stream, _) = stream(&owner);
    updater
        .download(
            owner.clone(),
            UpdateDownloadInput {
                update_id: id.clone(),
            },
            stream,
            "download",
        )
        .await
        .unwrap();
    if let Phase::Verified(verified) = &mut *updater.state.lock().unwrap() {
        verified.bytes[0] ^= 1;
    }
    assert_eq!(
        updater
            .prepare_install(owner, UpdateInstallInput { update_id: id })
            .err()
            .unwrap()
            .code(),
        SIGNATURE_INVALID
    );
    assert!(!updater.installing().unwrap());
    assert!(!driver.events.lock().unwrap().contains(&"installer"));
}

#[tokio::test]
async fn download_owner_digest_and_opaque_cancellation() {
    let root = root();
    let driver = Arc::new(FakeDriver {
        wait: true,
        ..Default::default()
    });
    let updater = Updater::new(Some(driver), root.path().join("updates"));
    let owner = owner();
    let id = available(&updater, &owner).await;
    let (stream, progress) = stream(&owner);
    let download = updater.download(
        owner.clone(),
        UpdateDownloadInput { update_id: id },
        stream,
        "download",
    );
    tokio::pin!(download);
    tokio::select! {
        result = &mut download => panic!("download ended early: {}", result.is_ok()),
        _ = tokio::time::sleep(std::time::Duration::from_millis(10)) => {}
    }
    let token = progress.lock().unwrap()[0].operation_id.clone();
    crate::data::validate_operation_id(&token).unwrap();
    assert!(
        !serde_json::to_string(&updater.status().unwrap())
            .unwrap()
            .contains(&token)
    );
    updater.cancel(&"0".repeat(32)).unwrap();
    assert!(matches!(
        updater.status().unwrap(),
        UpdateState::Downloading { .. }
    ));
    updater.cancel(&token).unwrap();
    assert!(matches!(
        download.await.unwrap(),
        UpdateState::Available { .. }
    ));
    updater.cancel(&token).unwrap();
    assert!(matches!(
        updater.status().unwrap(),
        UpdateState::Available { .. }
    ));
    let before = serde_json::to_value(updater.status().unwrap()).unwrap();
    assert!(
        updater
            .prepare_install(
                owner.clone(),
                UpdateInstallInput {
                    update_id: "unverified".into()
                }
            )
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(updater.status().unwrap()).unwrap(),
        before
    );
}

#[tokio::test]
async fn install_waits_for_shutdown_and_stays_stopped_on_error() {
    use crate::native::exit::ExitController;
    let root = root();
    let driver = Arc::new(FakeDriver::default());
    let updater = Arc::new(Updater::new(
        Some(driver.clone()),
        root.path().join("updates"),
    ));
    let owner = owner();
    let id = available(&updater, &owner).await;
    let (stream, _) = stream(&owner);
    assert!(matches!(
        updater
            .download(
                owner.clone(),
                UpdateDownloadInput {
                    update_id: id.clone()
                },
                stream,
                "download"
            )
            .await
            .unwrap(),
        UpdateState::Verified { .. }
    ));
    let wrong_owner = StreamOwner {
        actor: Actor::User(Id::new()),
        scope: "main".into(),
    };
    assert!(
        updater
            .prepare_install(
                wrong_owner,
                UpdateInstallInput {
                    update_id: id.clone()
                }
            )
            .is_err()
    );
    let plan = updater
        .prepare_install(
            owner.clone(),
            UpdateInstallInput {
                update_id: id.clone(),
            },
        )
        .unwrap();
    driver.events.lock().unwrap().push("command-finished");
    let gate = OperationGate::default();
    let permit = gate.enter().unwrap();
    gate.close_admission();
    let exit = ExitController::new(gate.clone());
    let runtime = tokio::runtime::Handle::current();
    let observed = driver.clone();
    let before: BeforeExit = Arc::new(move || {
        runtime.block_on(exit.request_exit(async {
            observed
                .events
                .lock()
                .unwrap()
                .extend(["streams", "windows", "native", "jobs"]);
            gate.close().await;
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            observed
                .events
                .lock()
                .unwrap()
                .extend(["modules", "database", "logs"]);
        }));
        observed.events.lock().unwrap().push("cleanup");
    });
    let worker_updater = updater.clone();
    let worker =
        tokio::task::spawn_blocking(move || worker_updater.install(plan, before, "install"));
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert!(!driver.events.lock().unwrap().contains(&"installer"));
    assert!(matches!(
        updater.status().unwrap(),
        UpdateState::Closing { .. }
    ));
    drop(permit);
    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(2), worker)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err()
            .code,
        INSTALL_FAILED.as_str()
    );
    assert_eq!(
        *driver.events.lock().unwrap(),
        [
            "check",
            "download",
            "command-finished",
            "streams",
            "windows",
            "native",
            "jobs",
            "modules",
            "database",
            "logs",
            "cleanup",
            "installer"
        ]
    );
    assert!(matches!(
        updater.status().unwrap(),
        UpdateState::StoppedAfterInstallFailure { .. }
    ));
    assert!(
        updater
            .prepare_install(owner.clone(), UpdateInstallInput { update_id: id })
            .is_err()
    );
    assert_eq!(
        updater
            .check(owner, || Ok(Arc::new(ProxySnapshot::Direct)), "retry")
            .await
            .err()
            .unwrap()
            .code(),
        OPERATION_BUSY
    );
    assert!(!updater.installing().unwrap());
}

#[tokio::test]
async fn signed_version_errors_and_download_limits_never_produce_install_plan() {
    assert_eq!(MANIFEST_LIMIT, 1_048_576);
    assert_eq!(DOWNLOAD_LIMIT, 262_144_000);
    for (failure, length, total) in [
        (Some(SIGNATURE_INVALID), None, None),
        (None, Some(DOWNLOAD_LIMIT as usize + 1), None),
        (None, None, Some(DOWNLOAD_LIMIT + 1)),
    ] {
        let root = root();
        let driver = Arc::new(FakeDriver {
            download_error: failure,
            reported_length: length,
            reported_total: total,
            ..Default::default()
        });
        let updater = Updater::new(Some(driver.clone()), root.path().join("updates"));
        let owner = owner();
        let id = available(&updater, &owner).await;
        let (stream, _) = stream(&owner);
        let error = updater
            .download(
                owner.clone(),
                UpdateDownloadInput {
                    update_id: id.clone(),
                },
                stream,
                "download",
            )
            .await
            .err()
            .unwrap();
        assert_eq!(error.code(), failure.unwrap_or(DOWNLOAD_TOO_LARGE));
        assert!(matches!(
            updater.status().unwrap(),
            UpdateState::Failed { .. }
        ));
        assert!(
            updater
                .prepare_install(owner, UpdateInstallInput { update_id: id })
                .is_err()
        );
        assert!(!driver.events.lock().unwrap().contains(&"installer"));
    }
}

#[tokio::test]
async fn download_requires_the_candidate_actor_scope_and_id() {
    let root = root();
    let driver = Arc::new(FakeDriver::default());
    let updater = Updater::new(Some(driver.clone()), root.path().join("updates"));
    let owner = owner();
    let id = available(&updater, &owner).await;
    for (requester, id) in [
        (
            StreamOwner {
                actor: Actor::User(Id::new()),
                scope: "main".into(),
            },
            id.clone(),
        ),
        (
            StreamOwner {
                actor: owner.actor,
                scope: "other".into(),
            },
            id,
        ),
        (owner.clone(), "another-candidate".into()),
    ] {
        let (stream, events) = stream(&requester);
        assert_eq!(
            updater
                .download(
                    requester,
                    UpdateDownloadInput { update_id: id },
                    stream,
                    "t"
                )
                .await
                .err()
                .unwrap()
                .code(),
            INVALID_RELEASE
        );
        assert!(events.lock().unwrap().is_empty());
    }
    assert_eq!(*driver.events.lock().unwrap(), ["check"]);
    assert!(matches!(
        updater.status().unwrap(),
        UpdateState::Available { .. }
    ));
    assert_eq!(
        updater
            .check(
                StreamOwner {
                    actor: Actor::System,
                    scope: "main".into()
                },
                || panic!("unauthorized must not read secrets"),
                "t"
            )
            .await
            .err()
            .unwrap()
            .code(),
        PERMISSION_DENIED
    );
}
