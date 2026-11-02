//! 窗口事件与编辑确认回归；通道替身不链接 Tauri。
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc,
};

use super::*;
use crate::config::{
    self, CloseAction, NativeSettingsChange, SETTINGS_OVERRIDDEN, TraySettingsChange,
};
use crate::native::tray::TrayAdapter;

#[derive(Default)]
struct Actions {
    exits: AtomicUsize,
    asks: Mutex<Vec<bool>>,
}
impl WindowActions for Actions {
    fn exit(&self) {
        self.exits.fetch_add(1, Ordering::SeqCst);
    }
    fn ask(&self, available: bool) -> Result<(), AppError> {
        self.asks.lock().unwrap().push(available);
        Ok(())
    }
}

#[derive(Default)]
struct Icon {
    hidden: AtomicUsize,
}
impl TrayAdapter for Icon {
    fn create(&self) -> Result<(), AppError> {
        Ok(())
    }
    fn remove(&self) -> Result<(), AppError> {
        Ok(())
    }
    fn show_main(&self) -> Result<(), AppError> {
        Ok(())
    }
    fn hide_main(&self) -> Result<(), AppError> {
        self.hidden.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

const INITIAL: WindowEvent = WindowEvent::State {
    maximized: false,
    focused: true,
};

#[test]
fn close_ask_rechecks_edits_before_exit_or_remembering_a_choice() {
    for edit in [
        WindowEditState {
            dirty: true,
            pending: false,
        },
        WindowEditState {
            dirty: false,
            pending: true,
        },
    ] {
        let (root, config, tray, icon, actions, controls) = fixture(true);
        let original = std::fs::read(root.path().join("config.toml")).unwrap();
        let (stream, events) = channel();
        controls.watch(&tray, stream, INITIAL).unwrap();
        events.recv().unwrap();
        controls.close_requested(&tray).unwrap();
        acknowledge_clean_page(&controls, &tray, &events);
        assert_eq!(events.recv().unwrap()["type"], "close_ask");
        controls.edit_state(edit).unwrap();
        assert_eq!(
            controls
                .decide(
                    &tray,
                    &config,
                    root.path(),
                    WindowCloseDecision {
                        action: CloseChoice::Exit,
                        remember: true
                    }
                )
                .unwrap_err()
                .code(),
            EDIT_UNAVAILABLE
        );
        assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
        assert_eq!(icon.hidden.load(Ordering::SeqCst), 0);
        assert_eq!(
            std::fs::read(root.path().join("config.toml")).unwrap(),
            original
        );
    }
}

#[test]
fn close_ask_reports_live_tray_and_refreshes_on_replacement() {
    for enabled in [false, true] {
        let (root, config, tray, _, actions, controls) = fixture(enabled);
        let (first, events) = channel();
        controls.watch(&tray, first, INITIAL).unwrap();
        events.recv().unwrap();
        controls.close_requested(&tray).unwrap();
        acknowledge_clean_page(&controls, &tray, &events);
        assert_eq!(
            events.recv().unwrap(),
            serde_json::json!({
                "type": "close_ask", "trayAvailable": enabled
            })
        );
        assert!(actions.asks.lock().unwrap().is_empty());
        tray.update(
            &config,
            root.path(),
            &TraySettingsChange {
                enabled: !enabled,
                close_action: CloseAction::Ask,
            },
        )
        .unwrap();
        let (replacement, events) = channel();
        controls.watch(&tray, replacement, INITIAL).unwrap();
        assert_eq!(
            events.recv().unwrap(),
            serde_json::to_value(INITIAL).unwrap()
        );
        assert_eq!(
            events.recv().unwrap(),
            serde_json::json!({
                "type": "close_ask", "trayAvailable": !enabled
            })
        );
    }
    let (_, config, _, _, _, controls) = fixture(true);
    let unavailable = Tray::new(None);
    unavailable.start(&config).unwrap();
    let (subscriber, events) = channel();
    controls.watch(&unavailable, subscriber, INITIAL).unwrap();
    events.recv().unwrap();
    controls.close_requested(&unavailable).unwrap();
    acknowledge_clean_page(&controls, &unavailable, &events);
    assert_eq!(
        events.recv().unwrap(),
        serde_json::json!({
            "type": "close_ask", "trayAvailable": false
        })
    );
    assert_eq!(
        serde_json::to_string(&WindowEvent::CloseAsk {
            tray_available: true
        })
        .unwrap(),
        r#"{"type":"close_ask","trayAvailable":true}"#
    );
}

fn channel() -> (WindowEvents, mpsc::Receiver<serde_json::Value>) {
    let (sender, receiver) = mpsc::channel();
    (
        Box::new(move |event| {
            sender
                .send(serde_json::to_value(event).unwrap())
                .map_err(|_| AppError::new(UNAVAILABLE))
        }),
        receiver,
    )
}

fn acknowledge_clean_page(
    controls: &WindowControls,
    tray: &Tray,
    events: &mpsc::Receiver<serde_json::Value>,
) {
    let request = events.recv().unwrap();
    assert_eq!(request["type"], "close_edit");
    controls
        .edit_decide(
            tray,
            WindowEditDecision {
                request_id: request["requestId"].as_str().unwrap().into(),
                proceed: true,
            },
        )
        .unwrap();
}

fn fixture(
    enabled: bool,
) -> (
    tempfile::TempDir,
    Mutex<LoadedConfig>,
    Tray,
    Arc<Icon>,
    Arc<Actions>,
    WindowControls,
) {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("config.toml"),
        format!("[window]\nclose_action='ask'\n[tray]\nenabled={enabled}\n"),
    )
    .unwrap();
    let config = Mutex::new(config::load(root.path(), [], &[]).unwrap());
    let icon = Arc::new(Icon::default());
    let tray = Tray::new(Some(icon.clone()));
    tray.start(&config).unwrap();
    let actions = Arc::new(Actions::default());
    let controls = WindowControls::new(OperationGate::default(), actions.clone());
    (root, config, tray, icon, actions, controls)
}

#[test]
fn watch_sends_snapshot_changes_replaces_and_releases_channels() {
    let (_, _, tray, _, _, controls) = fixture(false);
    let (first, first_events) = channel();
    controls.watch(&tray, first, INITIAL).unwrap();
    assert_eq!(
        first_events.recv().unwrap(),
        serde_json::json!({"type":"state","maximized":false,"focused":true})
    );
    controls.changed(INITIAL).unwrap();
    assert!(matches!(
        first_events.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    for (maximized, focused) in [(true, true), (false, true), (false, false), (false, true)] {
        controls
            .changed(WindowEvent::State { maximized, focused })
            .unwrap();
        assert_eq!(
            first_events.recv().unwrap(),
            serde_json::json!({"type":"state","maximized":maximized,"focused":focused})
        );
    }
    let (second, second_events) = channel();
    controls.watch(&tray, second, INITIAL).unwrap();
    assert!(matches!(
        first_events.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    ));
    second_events.recv().unwrap();
    controls.page_loading().unwrap();
    assert!(matches!(
        second_events.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    ));
    let (third, third_events) = channel();
    controls.watch(&tray, third, INITIAL).unwrap();
    third_events.recv().unwrap();
    controls.shutdown().unwrap();
    assert!(matches!(
        third_events.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    ));
    assert_eq!(
        controls
            .watch(&tray, channel().0, INITIAL)
            .unwrap_err()
            .code(),
        LIFECYCLE_CLOSING
    );
}

#[test]
fn movement_uses_the_control_channel_without_replacing_state_or_surviving_shutdown() {
    let (_, _, tray, _, _, controls) = fixture(false);
    let (stream, events) = channel();
    controls.watch(&tray, stream, INITIAL).unwrap();
    events.recv().unwrap();
    controls.moved(120, -80).unwrap();
    assert_eq!(
        events.recv().unwrap(),
        serde_json::json!({"type":"moved","x":120,"y":-80})
    );
    controls.changed(INITIAL).unwrap();
    assert!(matches!(events.try_recv(), Err(mpsc::TryRecvError::Empty)));
    controls.shutdown().unwrap();
    controls.moved(130, -70).unwrap();
    assert!(matches!(
        events.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    ));
}

#[test]
fn hiding_can_reenter_focus_events_without_blocking_the_native_thread() {
    struct ReentrantTray(Arc<WindowControls>);
    impl TrayAdapter for ReentrantTray {
        fn create(&self) -> Result<(), AppError> {
            Ok(())
        }
        fn remove(&self) -> Result<(), AppError> {
            Ok(())
        }
        fn show_main(&self) -> Result<(), AppError> {
            Ok(())
        }
        fn hide_main(&self) -> Result<(), AppError> {
            self.0
                .changed(WindowEvent::State {
                    maximized: false,
                    focused: false,
                })
                .unwrap();
            Ok(())
        }
    }
    let (root, config, _, _, _, controls) = fixture(true);
    let controls = Arc::new(controls);
    let tray = Tray::new(Some(Arc::new(ReentrantTray(controls.clone()))));
    tray.update(
        &config,
        root.path(),
        &TraySettingsChange {
            enabled: true,
            close_action: CloseAction::Tray,
        },
    )
    .unwrap();
    let (channel, events) = channel();
    controls.watch(&tray, channel, INITIAL).unwrap();
    events.recv().unwrap();
    let (done, completion) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        controls.close_after_edit(&tray).unwrap();
        done.send(()).unwrap();
    });
    completion
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("focus event must not deadlock close");
    worker.join().unwrap();
    assert_eq!(
        events.recv().unwrap(),
        serde_json::json!({"type":"state","maximized":false,"focused":false})
    );
}

#[test]
fn ask_keeps_open_and_remembered_choice_reopens_from_file() {
    for action in [CloseChoice::Tray, CloseChoice::Exit] {
        let (root, config, tray, icon, actions, controls) = fixture(true);
        let (channel, events) = channel();
        controls.watch(&tray, channel, INITIAL).unwrap();
        events.recv().unwrap();
        assert_eq!(
            controls
                .decide(
                    &tray,
                    &config,
                    root.path(),
                    WindowCloseDecision {
                        action,
                        remember: true
                    }
                )
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        controls.close_requested(&tray).unwrap();
        acknowledge_clean_page(&controls, &tray, &events);
        assert_eq!(
            events.recv().unwrap(),
            serde_json::json!({"type":"close_ask","trayAvailable":true})
        );
        assert_eq!(icon.hidden.load(Ordering::SeqCst), 0);
        assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
        controls
            .decide(
                &tray,
                &config,
                root.path(),
                WindowCloseDecision {
                    action,
                    remember: true,
                },
            )
            .unwrap();
        let saved = config::load(root.path(), [], &[])
            .unwrap()
            .native_settings();
        let expected = match action {
            CloseChoice::Tray => CloseAction::Tray,
            CloseChoice::Exit => CloseAction::Exit,
        };
        assert_eq!(saved.close_action.value, expected);
        assert!(saved.tray_enabled.value);
        assert_eq!(
            icon.hidden.load(Ordering::SeqCst),
            usize::from(expected == CloseAction::Tray)
        );
        assert_eq!(
            actions.exits.load(Ordering::SeqCst),
            usize::from(expected == CloseAction::Exit)
        );
        assert_eq!(
            controls
                .decide(
                    &tray,
                    &config,
                    root.path(),
                    WindowCloseDecision {
                        action,
                        remember: false
                    }
                )
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
    }
}

#[test]
fn remember_respects_both_sources_and_failed_write_keeps_ask_retryable() {
    let (root, config, tray, _, actions, controls) = fixture(true);
    let before = std::fs::read(root.path().join("config.toml")).unwrap();
    for key in ["tray.enabled", "window.close_action"] {
        for environment in [true, false] {
            let value = if key == "tray.enabled" { "true" } else { "ask" };
            *config.lock().unwrap() = config::load(
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
            controls.close_requested(&tray).unwrap();
            assert_eq!(
                controls
                    .decide(
                        &tray,
                        &config,
                        root.path(),
                        WindowCloseDecision {
                            action: CloseChoice::Exit,
                            remember: true
                        }
                    )
                    .unwrap_err()
                    .code(),
                SETTINGS_OVERRIDDEN
            );
            assert_eq!(
                std::fs::read(root.path().join("config.toml")).unwrap(),
                before
            );
        }
    }
    *config.lock().unwrap() = config::load(root.path(), [], &[]).unwrap();
    assert_eq!(
        controls
            .decide(
                &tray,
                &config,
                &root.path().join("missing"),
                WindowCloseDecision {
                    action: CloseChoice::Exit,
                    remember: true
                }
            )
            .unwrap_err()
            .code(),
        UNAVAILABLE
    );
    assert_eq!(
        config.lock().unwrap().native_settings().close_action.value,
        CloseAction::Ask
    );
    controls
        .decide(
            &tray,
            &config,
            root.path(),
            WindowCloseDecision {
                action: CloseChoice::Exit,
                remember: false,
            },
        )
        .unwrap();
    assert_eq!(actions.exits.load(Ordering::SeqCst), 1);
    assert_eq!(
        std::fs::read(root.path().join("config.toml")).unwrap(),
        before
    );
}

#[test]
fn missing_or_failed_subscriber_uses_native_prompt_without_unavailable_tray() {
    for enabled in [false, true] {
        let (root, config, tray, icon, actions, controls) = fixture(enabled);
        controls.close_requested(&tray).unwrap();
        controls.close_requested(&tray).unwrap();
        assert_eq!(*actions.asks.lock().unwrap(), [enabled]);
        controls.cancel_native_ask().unwrap();
        assert_eq!(
            controls
                .decide(
                    &tray,
                    &config,
                    root.path(),
                    WindowCloseDecision {
                        action: CloseChoice::Exit,
                        remember: false
                    }
                )
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        controls
            .watch(
                &tray,
                Box::new(|_| Err(AppError::new(UNAVAILABLE))),
                INITIAL,
            )
            .unwrap_err();
        controls.close_requested(&tray).unwrap();
        assert_eq!(*actions.asks.lock().unwrap(), [enabled, enabled]);
        if !enabled {
            assert_eq!(
                controls
                    .decide(
                        &tray,
                        &config,
                        root.path(),
                        WindowCloseDecision {
                            action: CloseChoice::Tray,
                            remember: true
                        }
                    )
                    .unwrap_err()
                    .code(),
                UNAVAILABLE
            );
            assert_eq!(icon.hidden.load(Ordering::SeqCst), 0);
            assert_eq!(
                config.lock().unwrap().native_settings().close_action.value,
                CloseAction::Ask
            );
        }
    }
}

#[test]
fn gate_closing_drops_events_and_prevents_close_decisions() {
    let (root, config, tray, _, actions, controls) = fixture(false);
    let (channel, events) = channel();
    controls.watch(&tray, channel, INITIAL).unwrap();

    events.recv().unwrap();
    controls.close_requested(&tray).unwrap();
    events.recv().unwrap();
    controls.gate.close_admission();
    controls
        .changed(WindowEvent::State {
            maximized: true,
            focused: false,
        })
        .unwrap();
    controls.close_requested(&tray).unwrap();
    assert!(matches!(events.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert_eq!(
        controls
            .decide(
                &tray,
                &config,
                root.path(),
                WindowCloseDecision {
                    action: CloseChoice::Exit,
                    remember: true
                }
            )
            .unwrap_err()
            .code(),
        LIFECYCLE_CLOSING
    );
    assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
}

#[test]
fn exit_and_tray_use_same_decision_path_and_ask_survives_disabled_tray() {
    let (root, config, tray, icon, actions, controls) = fixture(true);
    for (enabled, action) in [
        (true, CloseAction::Tray),
        (false, CloseAction::Exit),
        (false, CloseAction::Ask),
    ] {
        tray.update(
            &config,
            root.path(),
            &TraySettingsChange {
                enabled,
                close_action: action,
            },
        )
        .unwrap();
        controls.close_requested(&tray).unwrap();
    }
    assert_eq!(icon.hidden.load(Ordering::SeqCst), 1);
    assert_eq!(actions.exits.load(Ordering::SeqCst), 1);
    assert_eq!(*actions.asks.lock().unwrap(), [false]);
    // 只读布局事实不能通过原生设置写入 DTO。
    assert!(
        serde_json::from_str::<NativeSettingsChange>(
            r#"{"type":"window","restoreState":true,"titlebar":"hidden"}"#
        )
        .is_err()
    );
    for invalid in [
        r#"{"action":"ask","remember":true}"#,
        r#"{"action":"exit","remember":true,"window":"other"}"#,
    ] {
        assert!(serde_json::from_str::<WindowCloseDecision>(invalid).is_err());
    }
    assert_eq!(require_main("other").unwrap_err().code(), PERMISSION_DENIED);
    require_main("main").unwrap();
}

#[test]
fn first_dirty_publication_cannot_race_a_native_close() {
    let (root, config, tray, _, actions, controls) = fixture(false);
    tray.update(
        &config,
        root.path(),
        &TraySettingsChange {
            enabled: false,
            close_action: CloseAction::Exit,
        },
    )
    .unwrap();
    let (stream, events) = channel();
    controls.watch(&tray, stream, INITIAL).unwrap();
    events.recv().unwrap();
    // The host has not received the page's first dirty publication yet.
    controls.close_requested(&tray).unwrap();
    let request = events.recv().unwrap();
    assert_eq!(request["type"], "close_edit");
    assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
    controls
        .edit_state(WindowEditState {
            dirty: true,
            pending: false,
        })
        .unwrap();
    let id = request["requestId"].as_str().unwrap().to_owned();
    assert_eq!(
        controls
            .edit_decide(
                &tray,
                WindowEditDecision {
                    request_id: id.clone(),
                    proceed: true
                }
            )
            .unwrap_err()
            .code(),
        INPUT_INVALID
    );
    controls
        .edit_decide(
            &tray,
            WindowEditDecision {
                request_id: id,
                proceed: false,
            },
        )
        .unwrap();
    assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
    controls.edit_state(WindowEditState::default()).unwrap();
    controls.close_requested(&tray).unwrap();
    acknowledge_clean_page(&controls, &tray, &events);
    assert_eq!(actions.exits.load(Ordering::SeqCst), 1);
    assert!(
        matches!(events.try_recv(), Err(mpsc::TryRecvError::Empty)),
        "approval must not request another handshake"
    );
}

#[test]
fn unsaved_close_waits_for_acknowledged_clean_state_and_consumes_request_once() {
    let (root, config, tray, _, actions, controls) = fixture(false);
    tray.update(
        &config,
        root.path(),
        &TraySettingsChange {
            enabled: false,
            close_action: CloseAction::Exit,
        },
    )
    .unwrap();
    let (stream, events) = channel();
    controls.watch(&tray, stream, INITIAL).unwrap();
    events.recv().unwrap();
    controls
        .edit_state(WindowEditState {
            dirty: true,
            pending: false,
        })
        .unwrap();
    controls.close_requested(&tray).unwrap();
    let first = events.recv().unwrap();
    let id = first["requestId"].as_str().unwrap().to_owned();
    assert_eq!(first["type"], "close_edit");
    assert_eq!(uuid::Uuid::parse_str(&id).unwrap().get_version_num(), 4);
    controls.close_requested(&tray).unwrap();
    assert_eq!(events.recv().unwrap(), first);
    assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
    assert_eq!(
        controls
            .edit_decide(
                &tray,
                WindowEditDecision {
                    request_id: id.clone(),
                    proceed: true
                }
            )
            .unwrap_err()
            .code(),
        INPUT_INVALID
    );
    controls
        .edit_state(WindowEditState {
            dirty: false,
            pending: true,
        })
        .unwrap();
    assert_eq!(
        controls
            .edit_decide(
                &tray,
                WindowEditDecision {
                    request_id: id.clone(),
                    proceed: true
                }
            )
            .unwrap_err()
            .code(),
        INPUT_INVALID
    );
    controls
        .edit_state(WindowEditState {
            dirty: false,
            pending: false,
        })
        .unwrap();
    controls
        .edit_decide(
            &tray,
            WindowEditDecision {
                request_id: id.clone(),
                proceed: true,
            },
        )
        .unwrap();
    controls
        .edit_decide(
            &tray,
            WindowEditDecision {
                request_id: id,
                proceed: true,
            },
        )
        .unwrap();
    assert_eq!(actions.exits.load(Ordering::SeqCst), 1);
}

#[test]
fn dirty_edit_survives_missing_subscriber_and_explicit_quit_does_not_hide_to_tray() {
    let (root, config, tray, icon, actions, controls) = fixture(true);
    tray.update(
        &config,
        root.path(),
        &TraySettingsChange {
            enabled: true,
            close_action: CloseAction::Tray,
        },
    )
    .unwrap();
    controls
        .edit_state(WindowEditState {
            dirty: true,
            pending: false,
        })
        .unwrap();
    assert_eq!(
        controls.close_requested(&tray).unwrap_err().code(),
        EDIT_UNAVAILABLE
    );
    assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
    assert_eq!(icon.hidden.load(Ordering::SeqCst), 0);
    let (stream, events) = channel();
    controls.watch(&tray, stream, INITIAL).unwrap();
    events.recv().unwrap();
    let request = events.recv().unwrap();
    let id = request["requestId"].as_str().unwrap().to_owned();
    controls.page_loading().unwrap();
    assert_eq!(
        controls.exit_requested().unwrap_err().code(),
        EDIT_UNAVAILABLE
    );
    let (stream, next_events) = channel();
    controls.watch(&tray, stream, INITIAL).unwrap();
    next_events.recv().unwrap();
    assert_eq!(next_events.recv().unwrap(), request);
    controls.edit_state(WindowEditState::default()).unwrap();
    controls
        .edit_decide(
            &tray,
            WindowEditDecision {
                request_id: id,
                proceed: true,
            },
        )
        .unwrap();
    assert_eq!(actions.exits.load(Ordering::SeqCst), 1);
    assert_eq!(icon.hidden.load(Ordering::SeqCst), 0);
}

#[test]
fn edit_cancel_keeps_data_guard_and_shutdown_invalidates_decisions() {
    let (_, _, tray, _, actions, controls) = fixture(false);
    let (stream, events) = channel();
    controls.watch(&tray, stream, INITIAL).unwrap();
    events.recv().unwrap();
    controls
        .edit_state(WindowEditState {
            dirty: true,
            pending: false,
        })
        .unwrap();
    controls.close_requested(&tray).unwrap();
    let id = events.recv().unwrap()["requestId"]
        .as_str()
        .unwrap()
        .to_owned();
    controls
        .edit_decide(
            &tray,
            WindowEditDecision {
                request_id: id.clone(),
                proceed: false,
            },
        )
        .unwrap();
    controls.close_requested(&tray).unwrap();
    let next = events.recv().unwrap()["requestId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(id, next);
    controls
        .edit_decide(
            &tray,
            WindowEditDecision {
                request_id: id,
                proceed: true,
            },
        )
        .unwrap();
    assert_eq!(actions.exits.load(Ordering::SeqCst), 0);
    controls.gate.close_admission();
    controls.shutdown().unwrap();
    assert_eq!(
        controls
            .edit_decide(
                &tray,
                WindowEditDecision {
                    request_id: next,
                    proceed: true
                }
            )
            .unwrap_err()
            .code(),
        LIFECYCLE_CLOSING
    );
    assert_eq!(
        controls
            .edit_state(WindowEditState::default())
            .unwrap_err()
            .code(),
        LIFECYCLE_CLOSING
    );
}
