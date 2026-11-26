use super::{invoke, with_host_ports};
use crate::{boot, commands::*, native::tests::Effects, state::AppState};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::atomic::Ordering,
    sync::{Arc, mpsc},
};
use tauri::{
    Manager, WebviewWindow,
    ipc::{Channel, InvokeResponseBody},
    test::MockRuntime,
};

const CONTROLS: [&str; 8] = [
    "app_window_minimize",
    "app_window_toggle_maximize",
    "app_window_start_dragging",
    "app_window_close",
    "app_window_close_decide",
    "app_window_watch",
    "app_window_edit_state",
    "app_window_edit_decide",
];
const REQUEST: &str = "00000000-0000-4000-8000-000000000000";

fn input(command: &str) -> Value {
    match command {
        "app_window_close_decide" => json!({"input":{"action":"exit","remember":false}}),
        "app_window_watch" => json!({"onEvent":"__CHANNEL__:81"}),
        "app_window_edit_state" => json!({"input":{"dirty":false,"pending":false}}),
        "app_window_edit_decide" => json!({"input":{"requestId":REQUEST,"proceed":false}}),
        _ => json!({}),
    }
}

fn with_native(
    name: &str,
    config: &str,
    effects: Arc<Effects>,
    test: impl FnOnce(&WebviewWindow<MockRuntime>, &Path),
) {
    let mut ports = boot::tests::ports();
    ports.native = Box::new(move |root, config, _, lifecycle| {
        crate::native::tests::services(root, config, lifecycle, effects.clone())
    });
    with_host_ports(name, config, ports, |_| {}, test);
}

fn watch(window: &WebviewWindow<MockRuntime>) -> mpsc::Receiver<InvokeResponseBody> {
    let (sender, receiver) = mpsc::channel();
    let channel = Channel::<WindowEvent>::new(move |event| {
        sender.send(event).unwrap();
        Ok(())
    });
    tauri::async_runtime::block_on(app_window_watch::app_window_watch(
        window.state(),
        window.clone(),
        channel,
    ))
    .unwrap();
    receiver
}

fn event(receiver: &mpsc::Receiver<InvokeResponseBody>) -> Value {
    let InvokeResponseBody::Json(event) = receiver
        .recv_timeout(std::time::Duration::from_secs(1))
        .unwrap()
    else {
        panic!("raw JSON")
    };
    serde_json::from_str(&event).unwrap()
}

#[test]
fn window_controls_remain_available_while_locked_and_quiesced_but_stop_on_closing() {
    with_native(
        "ipc_tests::window_controls::window_controls_remain_available_while_locked_and_quiesced_but_stop_on_closing",
        "[window]\nclose_action='exit'\n",
        Arc::default(),
        |window, _| {
            invoke(
                window,
                "account_auth_enable_login",
                json!({"input":{"password":"owner-password"}}),
            )
            .unwrap();
            invoke(window, "account_auth_logout", json!({})).unwrap();
            assert_eq!(
                invoke(window, "app_native_settings_get", json!({})).unwrap_err()["code"],
                "account.auth.required"
            );
            let state = window.state::<AppState>();
            let exclusive = tauri::async_runtime::block_on(state.gate.quiesce()).unwrap();
            for command in CONTROLS
                .into_iter()
                .filter(|c| !matches!(*c, "app_window_watch" | "app_window_close_decide"))
            {
                invoke(window, command, input(command)).unwrap();
            }
            assert_eq!(
                invoke(
                    window,
                    "app_window_close_decide",
                    input("app_window_close_decide")
                )
                .unwrap_err()["code"],
                "app.input.invalid"
            );
            let receiver = watch(window);
            assert_eq!(
                event(&receiver),
                json!({"type":"state","maximized":false,"focused":false})
            );
            drop(exclusive);
            state.gate.close_admission();
            for command in CONTROLS {
                assert_eq!(
                    invoke(window, command, input(command)).unwrap_err()["code"],
                    "app.lifecycle.closing",
                    "{command}"
                );
            }
            state.native.window_controls.shutdown().unwrap();
            assert!(matches!(
                receiver.try_recv(),
                Err(mpsc::TryRecvError::Disconnected)
            ));
        },
    );
}

#[test]
fn raw_channel_replaces_subscription_preserves_edit_request_and_reports_actual_tray() {
    let effects = Arc::new(Effects::default());
    effects.fail_tray.store(true, Ordering::SeqCst);
    with_native(
        "ipc_tests::window_controls::raw_channel_replaces_subscription_preserves_edit_request_and_reports_actual_tray",
        "[tray]\nenabled=true\n[window]\nclose_action='ask'\n",
        effects.clone(),
        |window, _| {
            let first = watch(window);
            assert_eq!(event(&first)["type"], "state");
            let receiver = watch(window);
            assert!(matches!(
                first.try_recv(),
                Err(mpsc::TryRecvError::Disconnected)
            ));
            assert_eq!(event(&receiver)["type"], "state");
            let state = window.state::<AppState>();
            state.native.window_controls.moved(10, 20).unwrap();
            assert_eq!(event(&receiver), json!({"type":"moved","x":10,"y":20}));
            // clean 的活动页面也必须回答，避免首个 dirty IPC 仍在排队时关闭。
            invoke(window, "app_window_close", json!({})).unwrap();
            let edit = event(&receiver);
            assert_eq!(edit["type"], "close_edit");
            assert_eq!(effects.exits.load(Ordering::SeqCst), 0);
            state.native.window_controls.page_loading().unwrap();
            let receiver = watch(window);
            assert_eq!(event(&receiver)["type"], "state");
            assert_eq!(event(&receiver), edit);
            invoke(
                window,
                "app_window_edit_state",
                json!({"input":{"dirty":true,"pending":false}}),
            )
            .unwrap();
            assert_eq!(
                invoke(
                    window,
                    "app_window_edit_decide",
                    json!({"input":{"requestId":edit["requestId"],"proceed":true}})
                )
                .unwrap_err()["code"],
                "app.input.invalid"
            );
            invoke(
                window,
                "app_window_edit_state",
                input("app_window_edit_state"),
            )
            .unwrap();
            invoke(
                window,
                "app_window_edit_decide",
                json!({"input":{"requestId":edit["requestId"],"proceed":true}}),
            )
            .unwrap();
            assert_eq!(
                event(&receiver),
                json!({"type":"close_ask","trayAvailable":false})
            );
            invoke(
                window,
                "app_window_close_decide",
                input("app_window_close_decide"),
            )
            .unwrap();
            assert_eq!(effects.exits.load(Ordering::SeqCst), 1);
        },
    );
}

#[test]
fn non_main_window_is_rejected_by_acl_and_each_control_entry() {
    with_native(
        "ipc_tests::window_controls::non_main_window_is_rejected_by_acl_and_each_control_entry",
        "",
        Arc::default(),
        |window, root| {
            let other =
                tauri::WebviewWindowBuilder::new(window.app_handle(), "other", Default::default())
                    .data_directory(root.join("other"))
                    .build()
                    .unwrap();
            for command in CONTROLS {
                assert!(
                    invoke(&other, command, input(command)).is_err(),
                    "ACL: {command}"
                );
                let error = tauri::async_runtime::block_on(async {
                    match command {
                        "app_window_minimize" => {
                            app_window_minimize::app_window_minimize(other.state(), other.clone())
                                .await
                        }
                        "app_window_toggle_maximize" => {
                            app_window_toggle_maximize::app_window_toggle_maximize(
                                other.state(),
                                other.clone(),
                            )
                            .await
                        }
                        "app_window_start_dragging" => {
                            app_window_start_dragging::app_window_start_dragging(
                                other.state(),
                                other.clone(),
                            )
                            .await
                        }
                        "app_window_close" => {
                            app_window_close::app_window_close(other.state(), other.clone()).await
                        }
                        "app_window_close_decide" => {
                            app_window_close_decide::app_window_close_decide(
                                other.state(),
                                other.clone(),
                                serde_json::from_value(input(command)["input"].clone()).unwrap(),
                            )
                            .await
                        }
                        "app_window_watch" => {
                            app_window_watch::app_window_watch(
                                other.state(),
                                other.clone(),
                                Channel::new(|_| panic!("non-main channel")),
                            )
                            .await
                        }
                        "app_window_edit_state" => {
                            app_window_edit_state::app_window_edit_state(
                                other.state(),
                                other.clone(),
                                WindowEditState::default(),
                            )
                            .await
                        }
                        "app_window_edit_decide" => {
                            app_window_edit_decide::app_window_edit_decide(
                                other.state(),
                                other.clone(),
                                WindowEditDecision {
                                    request_id: REQUEST.into(),
                                    proceed: false,
                                },
                            )
                            .await
                        }
                        _ => panic!("unexpected control: {command}"),
                    }
                })
                .unwrap_err();
                assert_eq!(error.code, "app.permission.denied", "{command}");
            }
            for command in [
                "app_native_settings_get",
                "app_native_settings_update",
                "app_window_state_reset",
                "app_open_known_target",
            ] {
                assert!(invoke(&other, command, json!({"input":{"type":"window","restoreState":false,"target":"stateDirectory"}})).is_err(), "ACL: {command}");
            }
        },
    );
}

#[test]
fn close_remember_uses_atomic_settings_and_respects_override_without_identity() {
    let effects = Arc::new(Effects::default());
    with_native(
        "ipc_tests::window_controls::close_remember_uses_atomic_settings_and_respects_override_without_identity",
        "[window]\nclose_action='ask'\n",
        effects.clone(),
        |window, root| {
            invoke(
                window,
                "account_auth_enable_login",
                json!({"input":{"password":"owner-password"}}),
            )
            .unwrap();
            invoke(window, "account_auth_logout", json!({})).unwrap();
            invoke(window, "app_window_close", json!({})).unwrap();
            assert!(effects.calls.lock().unwrap().contains(&"ask:true".into()));
            invoke(
                window,
                "app_window_close_decide",
                json!({"input":{"action":"exit","remember":true}}),
            )
            .unwrap();
            assert_eq!(
                tenon_desktop::config::load(root, [], &[])
                    .unwrap()
                    .native_settings()
                    .close_action
                    .value,
                tenon_desktop::config::CloseAction::Exit
            );
            let state = window.state::<AppState>();
            *state.config.lock().unwrap() =
                tenon_desktop::config::load(root, [], &["window.close_action=ask".into()]).unwrap();
            state.native.tray.start(&state.config).unwrap();
            invoke(window, "app_window_close", json!({})).unwrap();
            assert_eq!(
                invoke(
                    window,
                    "app_window_close_decide",
                    json!({"input":{"action":"exit","remember":true}})
                )
                .unwrap_err()["code"],
                "app.settings.overridden"
            );
            invoke(
                window,
                "app_window_close_decide",
                input("app_window_close_decide"),
            )
            .unwrap();
            assert_eq!(effects.exits.load(Ordering::SeqCst), 2);
        },
    );
}

#[test]
fn native_settings_known_targets_and_saved_chrome_use_real_host_contracts() {
    let effects = Arc::new(Effects::default());
    effects.fail_chrome.store(true, Ordering::SeqCst);
    with_native(
        "ipc_tests::window_controls::native_settings_known_targets_and_saved_chrome_use_real_host_contracts",
        "",
        effects.clone(),
        |window, root| {
            let settings = invoke(window, "app_native_settings_get", json!({})).unwrap();
            assert_eq!(settings["canEdit"], true);
            assert!(settings["window"].get("titlebar").is_none());
            assert_eq!(settings["updater"]["configured"], false);
            let saved = invoke(
                window,
                "app_settings_update",
                json!({"input":{"theme":"dark","titlebar":"hidden"}}),
            )
            .unwrap();
            assert_eq!(saved["theme"]["value"], "dark");
            assert!(
                effects
                    .calls
                    .lock()
                    .unwrap()
                    .contains(&"theme:Dark:Standard:Hidden".into())
            );
            invoke(
                window,
                "app_native_settings_update",
                json!({"input":{"type":"window","restoreState":false}}),
            )
            .unwrap();
            assert_eq!(
                invoke(window, "app_native_settings_get", json!({})).unwrap()["window"]["state"],
                "disabled"
            );
            assert_eq!(
                invoke(
                    window,
                    "app_native_settings_update",
                    json!({"input":{"type":"autostart","enabled":true}})
                )
                .unwrap_err()["code"],
                "app.native.autostart_unsupported"
            );
            assert_eq!(
                invoke(
                    window,
                    "app_native_settings_update",
                    json!({"input":{"type":"shortcut","binding":"Ctrl+Shift+K"}})
                )
                .unwrap_err()["code"],
                "app.shortcut.unsupported"
            );
            for target in ["stateDirectory", "configDirectory", "logDirectory"] {
                invoke(
                    window,
                    "app_open_known_target",
                    json!({"input":{"target":target}}),
                )
                .unwrap();
            }
            assert_eq!(effects.opened.lock().unwrap().len(), 3);
            assert!(
                effects
                    .opened
                    .lock()
                    .unwrap()
                    .iter()
                    .all(|path| path.starts_with(root.canonicalize().unwrap()))
            );
            for input in [
                json!({"target":"support"}),
                json!({"target":"arbitrary"}),
                json!({"target":"stateDirectory","path":"C:/"}),
            ] {
                assert!(invoke(window, "app_open_known_target", json!({"input":input})).is_err());
            }
            assert_eq!(effects.opened.lock().unwrap().len(), 3);
            assert!(
                window
                    .state::<AppState>()
                    .require_owner(tenon_framework::actor::Actor::User(
                        tenon_framework::id::Id::new()
                    ))
                    .is_err()
            );
        },
    );
}

#[test]
fn titlebar_commit_failure_and_overrides_have_no_native_effects() {
    let effects = Arc::new(Effects::default());
    with_native(
        "ipc_tests::window_controls::titlebar_commit_failure_and_overrides_have_no_native_effects",
        "[ui]\ntheme='dark'\n[tray]\nenabled=false\n",
        effects.clone(),
        |window, root| {
            invoke(
                window,
                "app_settings_update",
                json!({"input":{"theme":"dark","titlebar":"native"}}),
            )
            .unwrap();
            assert!(effects.calls.lock().unwrap().is_empty());
            let state = window.state::<AppState>();
            let original = std::fs::read(root.join("config.toml")).unwrap();
            std::fs::write(root.join("config.toml"), "invalid = [").unwrap();
            assert!(
                invoke(
                    window,
                    "app_settings_update",
                    json!({"input":{"theme":"light","titlebar":"hidden"}})
                )
                .is_err()
            );
            assert!(effects.calls.lock().unwrap().is_empty());
            assert_eq!(
                state.config.lock().unwrap().settings().theme.value,
                tenon_desktop::config::Theme::Dark
            );
            std::fs::write(root.join("config.toml"), &original).unwrap();
            *state.config.lock().unwrap() =
                tenon_desktop::config::load(root, [], &["window.titlebar=native".into()]).unwrap();
            assert_eq!(
                invoke(
                    window,
                    "app_settings_update",
                    json!({"input":{"titlebar":"hidden","theme":"light"}})
                )
                .unwrap_err()["code"],
                "app.settings.overridden"
            );
            assert!(effects.calls.lock().unwrap().is_empty());
            assert_eq!(std::fs::read(root.join("config.toml")).unwrap(), original);
            *state.config.lock().unwrap() = tenon_desktop::config::load(root, [], &[]).unwrap();
            invoke(
                window,
                "app_settings_update",
                json!({"input":{"titlebar":"hidden"}}),
            )
            .unwrap();
            invoke(
                window,
                "app_settings_update",
                json!({"input":{"titlebar":"native"}}),
            )
            .unwrap();
            assert_eq!(
                *effects.calls.lock().unwrap(),
                [
                    "titlebar:Hidden",
                    "theme:Dark:Standard:Hidden",
                    "titlebar:Native",
                    "theme:Dark:Standard:Native",
                ]
            );
        },
    );
}

#[test]
fn tray_restore_reuses_main_and_explicit_quit_waits_for_edit_consent() {
    use tenon_desktop::native::{instance::MainWindowIntent, tray::TrayAction};
    let effects = Arc::new(Effects::default());
    with_native(
        "ipc_tests::window_controls::tray_restore_reuses_main_and_explicit_quit_waits_for_edit_consent",
        "[tray]\nenabled=true\n[window]\nclose_action='tray'\n",
        effects.clone(),
        |window, root| {
            let state = window.state::<AppState>();
            let intent = MainWindowIntent::new(state.gate.clone());
            intent.set_root(root.canonicalize().unwrap()).unwrap();
            crate::native::tray::dispatch(window.app_handle(), TrayAction::Show, &intent);
            assert!(intent.ready().unwrap());
            crate::native::tray::dispatch(window.app_handle(), TrayAction::Show, &intent);
            assert_eq!(window.app_handle().webview_windows().len(), 1);
            let receiver = watch(window);
            event(&receiver);
            crate::native::tray::dispatch(window.app_handle(), TrayAction::Exit, &intent);
            let edit = event(&receiver);
            assert_eq!(edit["type"], "close_edit");
            assert_eq!(effects.exits.load(Ordering::SeqCst), 0);
            invoke(
                window,
                "app_window_edit_decide",
                json!({"input":{"requestId":edit["requestId"],"proceed":true}}),
            )
            .unwrap();
            assert_eq!(effects.exits.load(Ordering::SeqCst), 1);
            assert!(!effects.calls.lock().unwrap().contains(&"tray:hide".into()));
        },
    );
}
