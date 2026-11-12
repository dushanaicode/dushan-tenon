use super::*;
use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tenon_desktop::{
    config::{Theme, Titlebar},
    native::{
        autostart::{AutostartScope, AutostartUnsupportedReason},
        tray::TrayAdapter,
        window_controls::WindowActions,
    },
};

#[derive(Default)]
pub(crate) struct Effects {
    pub calls: Mutex<Vec<String>>,
    pub opened: Mutex<Vec<PathBuf>>,
    pub exits: AtomicUsize,
    pub fail_chrome: AtomicBool,
    pub fail_tray: AtomicBool,
    pub config_probe: Mutex<Option<SharedConfig>>,
}

impl chrome::WindowChrome for Effects {
    fn apply(&self, theme: Theme, titlebar: Titlebar) -> Result<(), AppError> {
        if let Some(config) = self.config_probe.lock().unwrap().as_ref() {
            assert!(
                config.try_lock().is_ok(),
                "native API must run after releasing config"
            );
        }
        self.calls
            .lock()
            .unwrap()
            .push(format!("theme:{theme:?}:{titlebar:?}"));
        if self.fail_chrome.load(Ordering::SeqCst) {
            Err(AppError::new(UNAVAILABLE))
        } else {
            Ok(())
        }
    }
    fn set_titlebar(&self, titlebar: Titlebar) -> Result<(), AppError> {
        if let Some(config) = self.config_probe.lock().unwrap().as_ref() {
            assert_eq!(
                config.try_lock().unwrap().settings().titlebar.value,
                titlebar
            );
        }
        self.calls
            .lock()
            .unwrap()
            .push(format!("titlebar:{titlebar:?}"));
        if self.fail_chrome.load(Ordering::SeqCst) {
            Err(AppError::new(UNAVAILABLE))
        } else {
            Ok(())
        }
    }
}

impl TrayAdapter for Effects {
    fn create(&self) -> Result<(), AppError> {
        self.calls.lock().unwrap().push("tray:create".into());
        if self.fail_tray.load(Ordering::SeqCst) {
            Err(AppError::new(UNAVAILABLE))
        } else {
            Ok(())
        }
    }
    fn remove(&self) -> Result<(), AppError> {
        self.calls.lock().unwrap().push("tray:remove".into());
        Ok(())
    }
    fn show_main(&self) -> Result<(), AppError> {
        self.calls.lock().unwrap().push("tray:show".into());
        Ok(())
    }
    fn hide_main(&self) -> Result<(), AppError> {
        self.calls.lock().unwrap().push("tray:hide".into());
        Ok(())
    }
}

impl WindowActions for Effects {
    fn exit(&self) {
        self.exits.fetch_add(1, Ordering::SeqCst);
    }
    fn ask(&self, available: bool) -> Result<(), AppError> {
        self.calls.lock().unwrap().push(format!("ask:{available}"));
        Ok(())
    }
}

pub(crate) fn services(
    root: &Path,
    config: &SharedConfig,
    lifecycle: &Lifecycle,
    effects: Arc<Effects>,
) -> Result<NativeServices, AppError> {
    let target = effects.clone();
    let feedback = effects.clone();
    *effects.config_probe.lock().unwrap() = Some(config.clone());
    Ok(NativeServices {
        chrome: effects.clone(),
        tray: Arc::new(Tray::new(Some(effects.clone()))),
        window_controls: Arc::new(WindowControls::new(lifecycle.gate.clone(), effects)),
        autostart: Arc::new(Autostart::new(
            AutostartScope::Unsupported(AutostartUnsupportedReason::ExplicitStateRoot),
            None,
        )?),
        shortcuts: Arc::new(Shortcuts::new(
            None,
            Arc::new(ShortcutActivation::default()),
            "",
        )),
        window_state: window_state::create(
            root,
            ports::read(config)?.native_settings().restore_state.value,
        )?,
        known_targets: KnownTargets::new(
            root,
            Arc::new(move |path| {
                target.opened.lock().unwrap().push(path.into());
                Ok(())
            }),
        )?,
        updater: Updater::new(None, root.join("Temp/updates")),
        report_failure: Arc::new(move |error| {
            feedback
                .calls
                .lock()
                .unwrap()
                .push(format!("error:{}", error.code()))
        }),
    })
}

#[test]
fn saved_theme_and_titlebar_changes_apply_together_even_after_native_failure() {
    use tenon_desktop::config::{self, AppSettingsUpdate};
    let root = tempfile::tempdir().unwrap();
    let mut config = config::load(root.path(), [], &[]).unwrap();
    let before = config.settings();
    let saved = config
        .update_settings(
            root.path(),
            &serde_json::from_value::<AppSettingsUpdate>(
                serde_json::json!({"theme":"dark", "titlebar":"hidden"}),
            )
            .unwrap(),
        )
        .unwrap();
    let effects = Effects::default();
    effects.fail_chrome.store(true, Ordering::SeqCst);
    chrome::settings_changed(&effects, &before, &saved);
    assert_eq!(
        *effects.calls.lock().unwrap(),
        ["titlebar:Hidden", "theme:Dark:Hidden"]
    );
    assert_eq!(config.settings().titlebar.value, Titlebar::Hidden);
    assert_eq!(config.settings().theme.value, Theme::Dark);
    chrome::system_theme_changed(&effects, &saved);
    assert_eq!(effects.calls.lock().unwrap().len(), 2);
    let system = config::load(tempfile::tempdir().unwrap().path(), [], &[])
        .unwrap()
        .settings();
    chrome::system_theme_changed(&effects, &system);
    assert_eq!(
        effects.calls.lock().unwrap().last().unwrap(),
        "theme:System:Native"
    );
}

fn geometry() -> tauri_plugin_window_state::storage::Geometry {
    tauri_plugin_window_state::storage::Geometry {
        x: 20,
        y: 30,
        width: 1100.0,
        height: 720.0,
        scale_factor: 1.0,
        monitor: tauri_plugin_window_state::storage::MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
        maximized: false,
    }
}

#[test]
fn window_state_uses_explicit_root_and_shutdown_flushes_without_later_writes() {
    use tauri_plugin_window_state::{RestoreState, StateFlags};
    let root = tempfile::tempdir().unwrap();
    let state = window_state::create(root.path(), true).unwrap();
    assert_eq!(state.status().state, RestoreState::FirstRun);
    state.record(geometry(), false, false, true, StateFlags::all());
    state.shutdown().unwrap();
    let bytes = std::fs::read(root.path().join("window-state.json")).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(saved["version"], 1);
    assert_eq!(saved["main"]["x"], 20);
    assert!(saved["main"].get("visible").is_none());
    let mut moved = geometry();
    moved.x = 80;
    state.record(moved, false, false, true, StateFlags::all());
    state.flush().unwrap();
    assert_eq!(
        std::fs::read(root.path().join("window-state.json")).unwrap(),
        bytes
    );
    let restored = window_state::create(root.path(), true).unwrap();
    assert_eq!(restored.status().state, RestoreState::Restored);
    assert_eq!(restored.geometry().unwrap().x, 20);
    restored.shutdown().unwrap();
    let disabled_root = tempfile::tempdir().unwrap();
    let disabled = window_state::create(disabled_root.path(), false).unwrap();
    disabled.record(geometry(), false, false, true, StateFlags::all());
    disabled.shutdown().unwrap();
    assert_eq!(std::fs::read_dir(disabled_root.path()).unwrap().count(), 0);
}

#[test]
fn corrupt_window_state_is_preserved_until_explicit_reset() {
    use tauri_plugin_window_state::{RestoreState, StateFlags};
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("window-state.json");
    for bytes in ["broken", r#"{"version":2,"main":{}}"#] {
        std::fs::write(&file, bytes).unwrap();
        let state = window_state::create(root.path(), true).unwrap();
        assert_eq!(state.status().state, RestoreState::Failed);
        state.record(geometry(), false, false, true, StateFlags::all());
        state.flush().unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), bytes);
        state.reset(geometry()).unwrap();
        assert_eq!(state.status().state, RestoreState::Restored);
        assert_ne!(std::fs::read_to_string(&file).unwrap(), bytes);
        state.shutdown().unwrap();
    }
}

#[test]
fn failed_atomic_window_state_write_retains_previous_file() {
    let root = tempfile::tempdir().unwrap();
    let state = window_state::create(root.path(), true).unwrap();
    state.reset(geometry()).unwrap();
    let file = root.path().join("window-state.json");
    let bytes = std::fs::read(&file).unwrap();
    // scratch 根变为文件，持久化必须失败，不能覆写已保存的窗口状态。
    std::fs::remove_dir(root.path().join("Temp")).unwrap();
    std::fs::write(root.path().join("Temp"), "blocked").unwrap();
    let mut changed = geometry();
    changed.x = 100;
    assert!(state.reset(changed).is_err());
    assert_eq!(std::fs::read(&file).unwrap(), bytes);
    state.shutdown().unwrap();
}

#[test]
fn startup_applies_saved_appearance_before_reveal_and_tolerates_native_failure() {
    use crate::boot;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    if !boot::tests::child(
        "native::tests::startup_applies_saved_appearance_before_reveal_and_tolerates_native_failure",
    ) {
        return;
    }
    let root = boot::tests::root();
    std::fs::write(
        root.path().join("config.toml"),
        "[ui]\ntheme='dark'\n[window]\ntitlebar='hidden'\n[tray]\nenabled=false\n",
    )
    .unwrap();
    let mut context = mock_context(noop_assets());
    context.config_mut().build.dev_url = Some("http://localhost:17430".parse().unwrap());
    context
        .config_mut()
        .app
        .windows
        .push(tauri::utils::config::WindowConfig {
            label: "main".into(),
            create: false,
            visible: false,
            ..Default::default()
        });
    let app = mock_builder().build(context).unwrap();
    let lifecycle = Arc::new(Lifecycle::new());
    let effects = Arc::new(Effects::default());
    effects.fail_chrome.store(true, Ordering::SeqCst);
    let factory = effects.clone();
    let mut ports = boot::tests::ports();
    ports.native = Box::new(move |root, config, _, lifecycle| {
        services(root, config, lifecycle, factory.clone())
    });
    let running = tauri::async_runtime::block_on(boot::initialize(
        app.handle(),
        boot::Options {
            state_root: Some(root.path().into()),
            ..Default::default()
        },
        &lifecycle,
        ports,
    ))
    .unwrap();
    app.manage(running.state);
    crate::window::setup_window(app.handle(), lifecycle.clone()).unwrap();
    assert_eq!(*effects.calls.lock().unwrap(), ["theme:Dark:Hidden"]);
    assert!(app.get_webview_window("main").is_some());
    tauri::async_runtime::block_on(running.shutdown.shutdown());
    assert!(lifecycle.gate.is_closing());
}

#[test]
fn hidden_window_creation_applies_appearance_before_returning_to_reveal() {
    let effects = Effects::default();
    effects.fail_chrome.store(true, Ordering::SeqCst);
    let window = chrome::create_hidden_window(&effects, Theme::Dark, Titlebar::Hidden, || {
        effects.calls.lock().unwrap().push("create:hidden".into());
        Ok(7)
    })
    .unwrap();
    assert_eq!(window, 7);
    effects.calls.lock().unwrap().push("reveal".into());
    assert_eq!(
        *effects.calls.lock().unwrap(),
        ["create:hidden", "theme:Dark:Hidden", "reveal"]
    );
    effects.calls.lock().unwrap().clear();
    let failed = chrome::create_hidden_window(&effects, Theme::Dark, Titlebar::Hidden, || {
        Err::<(), _>(AppError::new(UNAVAILABLE))
    });
    assert!(failed.is_err());
    assert!(effects.calls.lock().unwrap().is_empty());
}
