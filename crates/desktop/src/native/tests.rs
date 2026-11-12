//! 托盘、退出、单实例和固定目标的假端口回归。
use super::{
    instance::{MainWindowIntent, secondary_root},
    opener::{KnownTarget, KnownTargets, OPEN_UNAVAILABLE},
};
use crate::config::CloseAction;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tenon_framework::maintenance::OperationGate;
#[derive(Default)]
struct TrayEffects {
    visible: bool,
    live: bool,
    events: Vec<&'static str>,
    failures: std::collections::VecDeque<&'static str>,
}

#[derive(Default)]
struct FakeTray(std::sync::Mutex<TrayEffects>);

impl FakeTray {
    fn effect(&self, name: &'static str) -> Result<(), tenon_framework::error::AppError> {
        let mut state = self.0.lock().unwrap();
        state.events.push(name);
        // 模拟 hide 已改变可见性但 OS 最后仍返回错误的情况。
        if name == "hide" {
            state.visible = false;
        }
        if state.failures.front() == Some(&name) {
            state.failures.pop_front();
            return Err(tenon_framework::error::AppError::new(super::UNAVAILABLE));
        }
        match name {
            "create" => state.live = true,
            "remove" => state.live = false,
            "show" => state.visible = true,
            "hide" => {}
            _ => panic!("unknown test effect"),
        }
        assert!(state.live || state.visible, "窗口和托盘不能同时不可达");
        Ok(())
    }
}

impl super::tray::TrayAdapter for FakeTray {
    fn create(&self) -> Result<(), tenon_framework::error::AppError> {
        self.effect("create")
    }
    fn remove(&self) -> Result<(), tenon_framework::error::AppError> {
        self.effect("remove")
    }
    fn show_main(&self) -> Result<(), tenon_framework::error::AppError> {
        self.effect("show")
    }
    fn hide_main(&self) -> Result<(), tenon_framework::error::AppError> {
        self.effect("hide")
    }
}

fn tray_fixture() -> (
    super::tray::Tray,
    Arc<FakeTray>,
    std::sync::Mutex<crate::config::LoadedConfig>,
    tempfile::TempDir,
) {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("config.toml"),
        "[tray]\nenabled=true\n[window]\nclose_action=\"tray\"\n",
    )
    .unwrap();
    let config = std::sync::Mutex::new(crate::config::load(root.path(), [], &[]).unwrap());
    let adapter = Arc::new(FakeTray::default());
    adapter.0.lock().unwrap().visible = true;
    let tray = super::tray::Tray::new(Some(adapter.clone()));
    (tray, adapter, config, root)
}

#[test]
fn tray_close_requires_live_icon() {
    use super::tray::{CloseOutcome, TrayStatus};
    let (tray, adapter, config, root) = tray_fixture();
    adapter.0.lock().unwrap().failures.push_back("create");
    tray.start(&config).unwrap();
    let failed = tray.settings(&config, "startup").unwrap();
    assert!(failed.enabled.value && failed.close_action.value == CloseAction::Tray);
    assert!(matches!(failed.state, TrayStatus::Unavailable));
    assert_eq!(tray.close_requested().unwrap(), CloseOutcome::Exit);
    assert!(adapter.0.lock().unwrap().visible);
    tray.update(
        &config,
        root.path(),
        &crate::config::TraySettingsChange {
            enabled: true,
            close_action: CloseAction::Tray,
        },
    )
    .unwrap();
    adapter.0.lock().unwrap().failures.push_back("hide");
    assert!(tray.close_requested().is_err());
    assert!(adapter.0.lock().unwrap().visible);
    assert!(adapter.0.lock().unwrap().live);
    assert_eq!(tray.close_requested().unwrap(), CloseOutcome::KeepOpen);
    assert!(!adapter.0.lock().unwrap().visible);
    tray.shutdown().unwrap();
    tray.shutdown().unwrap();
    let effects = adapter.0.lock().unwrap();
    assert!(effects.visible && !effects.live);
    assert_eq!(
        effects
            .events
            .iter()
            .filter(|event| **event == "remove")
            .count(),
        1
    );
}

#[test]
fn disable_tray_reveals_before_release() {
    let (tray, adapter, config, root) = tray_fixture();
    tray.start(&config).unwrap();
    tray.close_requested().unwrap();
    adapter.0.lock().unwrap().events.clear();
    let disabled = crate::config::TraySettingsChange {
        enabled: false,
        close_action: CloseAction::Exit,
    };
    // 写盘失败时保留旧配置与原图标，显窗不回滚为隐藏。
    assert!(
        tray.update(&config, &root.path().join("missing"), &disabled)
            .is_err()
    );
    {
        let effects = adapter.0.lock().unwrap();
        assert!(effects.visible && effects.live);
    }
    assert_eq!(
        config.lock().unwrap().native_settings().close_action.value,
        CloseAction::Tray
    );
    assert_eq!(adapter.0.lock().unwrap().events, ["show"]);
    adapter.0.lock().unwrap().events.clear();
    tray.update(&config, root.path(), &disabled).unwrap();
    assert_eq!(adapter.0.lock().unwrap().events, ["show", "remove"]);
    let saved = crate::config::load(root.path(), [], &[])
        .unwrap()
        .native_settings();
    assert!(!saved.tray_enabled.value && saved.close_action.value == CloseAction::Exit);
    assert_eq!(
        tray.close_requested().unwrap(),
        super::tray::CloseOutcome::Exit
    );
}

#[test]
fn show_failure_preserves_icon_and_configuration() {
    let (tray, adapter, config, root) = tray_fixture();
    tray.start(&config).unwrap();
    tray.close_requested().unwrap();
    adapter.0.lock().unwrap().failures.push_back("show");
    let before = std::fs::read(root.path().join("config.toml")).unwrap();
    assert!(
        tray.update(
            &config,
            root.path(),
            &crate::config::TraySettingsChange {
                enabled: false,
                close_action: CloseAction::Exit,
            }
        )
        .is_err()
    );
    assert!(adapter.0.lock().unwrap().live);
    assert_eq!(
        std::fs::read(root.path().join("config.toml")).unwrap(),
        before
    );
}

#[test]
fn enable_failure_compensates_and_reports_actual_icon() {
    use crate::config::TraySettingsChange;
    for compensation_fails in [false, true] {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("config.toml"),
            "[tray]\nenabled=false\n[window]\nclose_action='exit'\n",
        )
        .unwrap();
        let config = std::sync::Mutex::new(crate::config::load(root.path(), [], &[]).unwrap());
        let adapter = Arc::new(FakeTray::default());
        adapter.0.lock().unwrap().visible = true;
        if compensation_fails {
            adapter.0.lock().unwrap().failures.push_back("remove");
        }
        let tray = super::tray::Tray::new(Some(adapter.clone()));
        tray.start(&config).unwrap();
        assert!(adapter.0.lock().unwrap().events.is_empty()); // 默认种子零托盘效果。
        let error = tray
            .update(
                &config,
                &root.path().join("missing"),
                &TraySettingsChange {
                    enabled: true,
                    close_action: CloseAction::Tray,
                },
            )
            .unwrap_err();
        let status = tray.settings(&config, "persist").unwrap();
        assert!(!status.enabled.value && status.close_action.value == CloseAction::Exit);
        assert_eq!(adapter.0.lock().unwrap().live, compensation_fails);
        assert_eq!(
            error.code(),
            if compensation_fails {
                super::COMPENSATION_FAILED
            } else {
                super::UNAVAILABLE
            }
        );
        assert_eq!(
            tray.close_requested().unwrap(),
            super::tray::CloseOutcome::Exit
        );
    }
}

#[test]
fn pending_close_does_not_block_the_native_thread() {
    struct PendingTray {
        entered: std::sync::mpsc::Sender<()>,
        resume: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl super::tray::TrayAdapter for PendingTray {
        fn create(&self) -> Result<(), tenon_framework::error::AppError> {
            self.entered.send(()).unwrap();
            self.resume
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(2))
                .unwrap();
            Ok(())
        }
        fn remove(&self) -> Result<(), tenon_framework::error::AppError> {
            Ok(())
        }
        fn show_main(&self) -> Result<(), tenon_framework::error::AppError> {
            Ok(())
        }
        fn hide_main(&self) -> Result<(), tenon_framework::error::AppError> {
            Ok(())
        }
    }
    let (entered, receive) = std::sync::mpsc::channel();
    let (resume, wait) = std::sync::mpsc::channel();
    let tray = Arc::new(super::tray::Tray::new(Some(Arc::new(PendingTray {
        entered,
        resume: std::sync::Mutex::new(wait),
    }))));
    let worker_tray = tray.clone();
    let worker = std::thread::spawn(move || {
        let root = tempfile::tempdir().unwrap();
        worker_tray
            .update(
                &std::sync::Mutex::new(crate::native::test_config()),
                root.path(),
                &crate::config::TraySettingsChange {
                    enabled: true,
                    close_action: CloseAction::Tray,
                },
            )
            .unwrap();
    });
    receive.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(
        tray.close_requested().unwrap(),
        super::tray::CloseOutcome::KeepOpen
    );
    resume.send(()).unwrap();
    worker.join().unwrap();
}

#[test]
fn sources_and_unsupported_platform_have_no_native_effects() {
    use crate::config::TraySettingsChange;
    let root = tempfile::tempdir().unwrap();
    let adapter = Arc::new(FakeTray::default());
    let tray = super::tray::Tray::new(Some(adapter.clone()));
    for (key, value) in [("tray.enabled", "false"), ("window.close_action", "exit")] {
        for environment in [false, true] {
            let config = crate::config::load(
                root.path(),
                if environment {
                    vec![(
                        format!("TENON__{}", key.replace('.', "__").to_uppercase()),
                        value.into(),
                    )]
                } else {
                    vec![]
                },
                &if environment {
                    vec![]
                } else {
                    vec![format!("{key}={value}")]
                },
            )
            .unwrap();
            assert_eq!(
                tray.update(
                    &std::sync::Mutex::new(config),
                    root.path(),
                    &TraySettingsChange {
                        enabled: true,
                        close_action: CloseAction::Tray,
                    }
                )
                .unwrap_err()
                .code(),
                crate::config::SETTINGS_OVERRIDDEN
            );
        }
    }
    assert!(adapter.0.lock().unwrap().events.is_empty());
    let unsupported = super::tray::Tray::new(None);
    std::fs::write(
        root.path().join("config.toml"),
        "[window]\nclose_action='exit'\n",
    )
    .unwrap();
    let config = std::sync::Mutex::new(crate::config::load(root.path(), [], &[]).unwrap());
    unsupported.start(&config).unwrap();
    assert_eq!(
        unsupported
            .settings(&config, "unsupported")
            .unwrap()
            .error
            .unwrap()
            .code,
        super::tray::UNSUPPORTED.as_str()
    );
    assert_eq!(
        unsupported.close_requested().unwrap(),
        super::tray::CloseOutcome::Exit
    );
    assert_eq!(
        unsupported
            .update(
                &config,
                root.path(),
                &TraySettingsChange {
                    enabled: true,
                    close_action: CloseAction::Exit,
                }
            )
            .unwrap_err()
            .code(),
        super::tray::UNSUPPORTED
    );
}

#[test]
fn single_instance_defers_show() {
    let gate = OperationGate::default();
    let intent = MainWindowIntent::new(gate.clone());
    let root = PathBuf::from("same-root");
    assert!(!intent.request_show(Some(root.clone())).unwrap());
    intent.set_root(root.clone()).unwrap();
    assert!(!intent.request_show(Some(root.clone())).unwrap());
    assert!(intent.ready().unwrap());
    assert!(!intent.ready().unwrap());
    assert!(intent.request_show(None).unwrap());
    assert!(intent.request_show(Some(root)).unwrap());
    assert!(
        !intent
            .request_show(Some(PathBuf::from("different-root")))
            .unwrap()
    );
    gate.close_admission();
    assert!(!intent.request_show(None).unwrap());
    assert!(!intent.ready().unwrap());

    let gate = OperationGate::default();
    let intent = MainWindowIntent::new(gate.clone());
    assert!(!intent.request_show(None).unwrap());
    gate.close_admission();
    assert!(!intent.ready().unwrap());

    let intent = MainWindowIntent::new(OperationGate::default());
    intent.request_show(Some(PathBuf::from("other"))).unwrap();
    intent.set_root(PathBuf::from("current")).unwrap();
    assert!(!intent.ready().unwrap());
}

#[test]
fn secondary_root_uses_only_explicit_argv_and_sender_cwd() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("state")).unwrap();
    let cwd = root.path().to_str().unwrap();
    let args = |values: &[&str]| {
        values
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>()
    };
    for explicit in [
        vec!["app", "--state-root", "state"],
        vec!["app", "--state-root=state"],
    ] {
        assert_eq!(
            secondary_root(&args(&explicit), cwd).unwrap(),
            Some(root.path().join("state").canonicalize().unwrap())
        );
    }
    assert_eq!(
        secondary_root(
            &args(&["app", "--set", "ignored=true", "https://ignored.invalid"]),
            cwd
        )
        .unwrap(),
        None
    );
    assert_eq!(
        secondary_root(&args(&["app", "--set", "--state-root=state"]), cwd).unwrap(),
        None
    );
    assert_eq!(
        secondary_root(&args(&["app", "--", "--state-root=state"]), cwd).unwrap(),
        None
    );
    for invalid in [
        vec!["app", "--state-root"],
        vec!["app", "--state-root="],
        vec!["app", "--state-root", "missing"],
        vec!["app", "--state-root=state", "--state-root=state"],
    ] {
        assert!(secondary_root(&args(&invalid), cwd).is_err());
    }
    assert!(!root.path().join("missing").exists());
}

#[test]
fn poisoned_native_locks_return_errors() {
    use tenon_framework::error::INTERNAL_UNEXPECTED;
    let tray = super::tray::Tray::new(None);
    let config = std::sync::Mutex::new(super::test_config());
    std::thread::scope(|scope| {
        let failed = scope.spawn(|| {
            let _guard = config.lock().unwrap();
            panic!("poison fixture");
        });
        assert!(failed.join().is_err());
    });
    assert_eq!(tray.start(&config).unwrap_err().code(), INTERNAL_UNEXPECTED);
}
#[test]
fn known_targets_reject_missing_escaped_and_failed_os_requests() {
    let root = tempfile::tempdir().unwrap();
    let state = root.path().join("state");
    std::fs::create_dir(&state).unwrap();
    let opened = Arc::new(std::sync::Mutex::new(Vec::new()));
    let observed = opened.clone();
    let targets = KnownTargets::new(
        &state,
        Arc::new(move |path| {
            observed.lock().unwrap().push(path.to_owned());
            Ok(())
        }),
    )
    .unwrap();
    targets.open(KnownTarget::StateDirectory).unwrap();
    targets.open(KnownTarget::ConfigDirectory).unwrap();
    for target in [KnownTarget::LogDirectory, KnownTarget::Support] {
        let error = targets.open(target).unwrap_err();
        assert_eq!(error.code(), OPEN_UNAVAILABLE);
        assert!(std::error::Error::source(&error).is_none());
    }
    assert!(!state.join("logs").exists());
    let outside = root.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let status = std::process::Command::new("powershell.exe")
            .creation_flags(0x0800_0000)
            .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:TENON_TEST_LINK_PATH -Target $env:TENON_TEST_LINK_TARGET -ErrorAction Stop | Out-Null"])
            .env("TENON_TEST_LINK_PATH", state.join("logs"))
            .env("TENON_TEST_LINK_TARGET", &outside)
            .status().unwrap();
        assert!(status.success());
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, state.join("logs")).unwrap();
    assert_eq!(
        targets.open(KnownTarget::LogDirectory).unwrap_err().code(),
        OPEN_UNAVAILABLE
    );
    assert_eq!(
        *opened.lock().unwrap(),
        [state.canonicalize().unwrap(), state.canonicalize().unwrap()]
    );
    let failed = KnownTargets::new(
        &state,
        Arc::new(|_| Err(tenon_framework::error::AppError::new(OPEN_UNAVAILABLE))),
    )
    .unwrap();
    assert_eq!(
        failed.open(KnownTarget::StateDirectory).unwrap_err().code(),
        OPEN_UNAVAILABLE
    );
}
