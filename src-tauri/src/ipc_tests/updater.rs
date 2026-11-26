use super::{invoke, with_host, with_host_ports};
use crate::{boot, commands, lifecycle::Lifecycle, state::AppState};
use serde_json::{Value, json};
use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tauri::{
    Manager, WebviewWindow,
    ipc::{Channel, InvokeResponseBody},
    test::MockRuntime,
};
use tenon_desktop::{data::OperationProgress, native::updater::*};
use tenon_framework::{
    actor::Actor,
    error::AppError,
    id::Id,
    ipc::{ActiveActor, ActorResolver},
    network::ProxySnapshot,
    stream::StreamEvent,
};

mod vendor;

type InstallProbe = Box<dyn Fn() + Send + Sync>;
#[derive(Default)]
struct Driver {
    checks: AtomicUsize,
    installs: AtomicUsize,
    pending: AtomicBool,
    proxy: Mutex<Option<Arc<ProxySnapshot>>>,
    scratch: Mutex<Option<PathBuf>>,
    install_probe: Mutex<Option<InstallProbe>>,
}
impl UpdateDriver for Driver {
    fn check(
        &self,
        proxy: Arc<ProxySnapshot>,
        scratch: PathBuf,
    ) -> UpdateFuture<'_, Option<ReleaseInfo>> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        *self.proxy.lock().unwrap() = Some(proxy);
        *self.scratch.lock().unwrap() = Some(scratch);
        Box::pin(async {
            Ok(Some(ReleaseInfo {
                version: "0.2.0".into(),
                published_at: None,
                notes: "synthetic".into(),
            }))
        })
    }
    fn download(&self, _: DownloadProgress) -> UpdateFuture<'_, Vec<u8>> {
        Box::pin(async move {
            if self.pending.load(Ordering::SeqCst) {
                std::future::pending::<()>().await;
            }
            Ok(b"MZsynthetic non-executable fixture".to_vec())
        })
    }
    fn install(&self, _: Vec<u8>) -> Result<(), AppError> {
        if let Some(probe) = self.install_probe.lock().unwrap().as_ref() {
            probe();
        }
        self.installs.fetch_add(1, Ordering::SeqCst);
        Err(AppError::new(INSTALL_FAILED))
    }
}

struct Resolver {
    actor: Mutex<Actor>,
    forbidden: AtomicBool,
    calls: AtomicUsize,
}
impl ActorResolver for Resolver {
    fn resolve_active(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<ActiveActor, AppError>> + Send + '_>> {
        assert!(
            !self.forbidden.load(Ordering::SeqCst),
            "identity must not be resolved"
        );
        self.calls.fetch_add(1, Ordering::SeqCst);
        let actor = *self.actor.lock().unwrap();
        Box::pin(async move {
            Ok(ActiveActor {
                actor,
                permissions: vec![],
            })
        })
    }
    fn resolve_session(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Actor, AppError>> + Send + '_>> {
        panic!("session entry")
    }
    fn resolve_public(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Actor>, AppError>> + Send + '_>> {
        panic!("public entry")
    }
}
fn resolver() -> Arc<Resolver> {
    Arc::new(Resolver {
        actor: Mutex::new(Actor::User(Id::new())),
        forbidden: AtomicBool::new(false),
        calls: AtomicUsize::new(0),
    })
}
fn with_driver(
    name: &str,
    driver: Arc<Driver>,
    prepare: impl FnOnce(&mut AppState),
    test: impl FnOnce(&WebviewWindow<MockRuntime>, &Path),
) {
    let mut ports = boot::tests::ports();
    ports.native = Box::new(move |root, config, _, lifecycle| {
        let mut native = crate::native::tests::services(root, config, lifecycle, Arc::default())?;
        native.updater = Updater::new(Some(driver.clone()), root.join("Temp/updates"));
        Ok(native)
    });
    with_host_ports(name, "[notify]\ndesktop=false\n", ports, prepare, test);
}
fn input(command: &str, id: &str) -> Value {
    match command {
        "app_update_download" => json!({"input":{"updateId":id},"channel":"__CHANNEL__:84"}),
        "app_update_install" => json!({"input":{"updateId":id}}),
        _ => json!({}),
    }
}
const COMMANDS: [&str; 4] = [
    "app_update_status",
    "app_update_check",
    "app_update_download",
    "app_update_install",
];

#[test]
fn null_configuration_has_no_plugin_consumer_or_scratch() {
    with_host(
        "ipc_tests::updater::null_configuration_has_no_plugin_consumer_or_scratch",
        "",
        |_| {},
        |window, root| {
            let updater = crate::native::updater::create_from(
                window.app_handle().clone(),
                root.join("Temp/updates"),
                "null",
            )
            .unwrap();
            assert!(!updater.configured());
            assert!(!window.app_handle().remove_plugin("updater"));
            crate::native::updater::check_on_start(window.app_handle().clone()).unwrap();
            assert_eq!(
                invoke(window, "app_update_status", json!({})).unwrap()["status"],
                "unconfigured"
            );
            for command in &COMMANDS[1..] {
                assert_eq!(
                    invoke(window, command, input(command, "unknown")).unwrap_err()["code"],
                    UNCONFIGURED.as_str()
                );
            }
            assert_eq!(
                invoke(
                    window,
                    "app_native_settings_update",
                    json!({"input":{"type":"updater","checkOnStart":true}})
                )
                .unwrap_err()["code"],
                UNCONFIGURED.as_str()
            );
            // 仓库的发行配置绑定 identifier 与生成的插件配置；测试宿主两者都不同，拒绝且不注册插件。
            assert_eq!(
                crate::native::updater::create_from(
                    window.app_handle().clone(),
                    root.join("Temp/updates"),
                    include_str!("../../release.json"),
                )
                .err()
                .map(|error| error.code()),
                Some(INVALID_RELEASE)
            );
            assert!(!window.app_handle().remove_plugin("updater"));
            assert!(!root.join("Temp/updates").exists());
        },
    );
}

#[test]
fn update_commands_require_active_identity_and_main_capability() {
    with_host(
        "ipc_tests::updater::update_commands_require_active_identity_and_main_capability",
        "",
        |_| {},
        |window, _| {
            invoke(
                window,
                "account_auth_enable_login",
                json!({"input":{"password":"owner-password"}}),
            )
            .unwrap();
            invoke(window, "account_auth_logout", json!({})).unwrap();
            for command in COMMANDS {
                let error = invoke(window, command, input(command, "unknown")).unwrap_err();
                assert!(
                    error["code"].as_str().unwrap().starts_with("account."),
                    "{command}: {error}"
                );
            }
            let other = tauri::WebviewWindowBuilder::new(
                window.app_handle(),
                "secondary",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .build()
            .unwrap();
            for command in COMMANDS {
                assert!(invoke(&other, command, input(command, "unknown")).is_err());
            }
            assert!(
                invoke(
                    window,
                    "app_operation_cancel",
                    json!({"input":{"operationId":"00000000000000000000000000000000"}})
                )
                .is_ok()
            );
        },
    );
}

#[test]
fn update_check_download_install_reject_non_owner_before_driver() {
    let driver = Arc::new(Driver::default());
    let identity = resolver();
    let prepared = identity.clone();
    with_driver(
        "ipc_tests::updater::update_check_download_install_reject_non_owner_before_driver",
        driver.clone(),
        move |state| {
            state.identity.actor_resolver = prepared;
        },
        |window, _| {
            assert_eq!(
                invoke(window, "app_update_status", json!({})).unwrap()["status"],
                "idle"
            );
            for command in &COMMANDS[1..] {
                assert_eq!(
                    invoke(window, command, input(command, "unknown")).unwrap_err()["code"],
                    "app.native.owner_required"
                );
            }
            assert_eq!(driver.checks.load(Ordering::SeqCst), 0);
            assert_eq!(driver.installs.load(Ordering::SeqCst), 0);
        },
    );
}

#[test]
fn download_cancel_uses_same_control_without_identity_and_keeps_candidate() {
    let driver = Arc::new(Driver::default());
    driver.pending.store(true, Ordering::SeqCst);
    let identity = resolver();
    let prepared = identity.clone();
    with_driver(
        "ipc_tests::updater::download_cancel_uses_same_control_without_identity_and_keeps_candidate",
        driver.clone(),
        move |state| {
            *prepared.actor.lock().unwrap() = Actor::User(state.account.owner_id().unwrap());
            state.identity.actor_resolver = prepared;
        },
        |window, root| {
            let release = invoke(window, "app_update_check", json!({})).unwrap();
            let id = release["release"]["updateId"].as_str().unwrap().to_owned();
            assert!(
                driver
                    .scratch
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .starts_with(root.join("Temp/updates"))
            );
            let (sender, receiver) = std::sync::mpsc::channel();
            let channel = Channel::<StreamEvent<OperationProgress>>::new(move |event| {
                sender.send(event).unwrap();
                Ok(())
            });
            tauri::async_runtime::block_on(async {
                let download = commands::app_update_download::app_update_download(
                    window.clone(),
                    window.state(),
                    UpdateDownloadInput {
                        update_id: id.clone(),
                    },
                    channel,
                );
                tokio::pin!(download);
                assert!(
                    tokio::time::timeout(Duration::from_millis(20), &mut download)
                        .await
                        .is_err()
                );
                let token = loop {
                    let InvokeResponseBody::Json(event) =
                        receiver.recv_timeout(Duration::from_secs(1)).unwrap()
                    else {
                        panic!("JSON event")
                    };
                    let event: Value = serde_json::from_str(&event).unwrap();
                    if let Some(id) = event["data"]["operationId"].as_str() {
                        break id.to_owned();
                    }
                };
                let state = window.state::<AppState>();
                assert!(
                    !serde_json::to_string(&state.native.updater.status().unwrap())
                        .unwrap()
                        .contains(&token)
                );
                identity.forbidden.store(true, Ordering::SeqCst);
                let calls = identity.calls.load(Ordering::SeqCst);
                for token in ["00000000000000000000000000000000", &id] {
                    commands::app_operation_cancel::app_operation_cancel(
                        window.state(),
                        dushan_tenon_lib::contract::OperationCancelInput {
                            operation_id: token.into(),
                        },
                    )
                    .await
                    .unwrap();
                    assert!(matches!(
                        state.native.updater.status().unwrap(),
                        UpdateState::Downloading { .. }
                    ));
                }
                commands::app_operation_cancel::app_operation_cancel(
                    window.state(),
                    dushan_tenon_lib::contract::OperationCancelInput {
                        operation_id: token.clone(),
                    },
                )
                .await
                .unwrap();
                assert!(matches!(
                    download.await.unwrap(),
                    UpdateState::Available { .. }
                ));
                commands::app_operation_cancel::app_operation_cancel(
                    window.state(),
                    dushan_tenon_lib::contract::OperationCancelInput {
                        operation_id: token,
                    },
                )
                .await
                .unwrap();
                assert_eq!(identity.calls.load(Ordering::SeqCst), calls);
            });
        },
    );
}

struct DelayedTray {
    started: std::sync::mpsc::Sender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}
impl tenon_desktop::native::tray::TrayAdapter for DelayedTray {
    fn create(&self) -> Result<(), AppError> {
        Ok(())
    }
    fn remove(&self) -> Result<(), AppError> {
        self.started.send(()).unwrap();
        self.release
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        Ok(())
    }
    fn show_main(&self) -> Result<(), AppError> {
        Ok(())
    }
    fn hide_main(&self) -> Result<(), AppError> {
        Ok(())
    }
}

#[test]
fn install_waits_for_complete_shutdown_and_failure_stops_all_ipc() {
    let driver = Arc::new(Driver::default());
    let identity = resolver();
    let prepared = identity.clone();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let tray = Arc::new(DelayedTray {
        started: started_tx,
        release: Mutex::new(release_rx),
    });
    let mut ports = boot::tests::ports();
    let injected = driver.clone();
    ports.native = Box::new(move |root, config, _, lifecycle| {
        let mut native = crate::native::tests::services(root, config, lifecycle, Arc::default())?;
        native.updater = Updater::new(Some(injected.clone()), root.join("Temp/updates"));
        native.tray = Arc::new(tenon_desktop::native::tray::Tray::new(Some(tray.clone())));
        Ok(native)
    });
    with_host_ports(
        "ipc_tests::updater::install_waits_for_complete_shutdown_and_failure_stops_all_ipc",
        "[tray]\nenabled=true\n[window]\nclose_action='tray'\n[notify]\ndesktop=false\n",
        ports,
        move |state| {
            *prepared.actor.lock().unwrap() = Actor::User(state.account.owner_id().unwrap());
            state.identity.actor_resolver = prepared;
        },
        |window, _| {
            window.set_decorations(false).unwrap();
            let checked = invoke(window, "app_update_check", json!({})).unwrap();
            let id = checked["release"]["updateId"].as_str().unwrap().to_owned();
            assert_eq!(
                invoke(
                    window,
                    "app_update_download",
                    input("app_update_download", &id)
                )
                .unwrap()["status"],
                "verified"
            );
            let state = window.state::<AppState>();
            let lifecycle = window.state::<Arc<Lifecycle>>().inner().clone();
            let probe_lifecycle = lifecycle.clone();
            *driver.install_probe.lock().unwrap() = Some(Box::new(move || {
                assert!(probe_lifecycle.exit.is_finished())
            }));
            std::thread::scope(|scope| {
                let installer = scope.spawn(|| {
                    invoke(
                        window,
                        "app_update_install",
                        input("app_update_install", &id),
                    )
                });
                started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                identity.forbidden.store(true, Ordering::SeqCst);
                assert_eq!(driver.installs.load(Ordering::SeqCst), 0);
                assert!(!lifecycle.exit.is_finished());
                for command in COMMANDS {
                    assert_eq!(
                        invoke(window, command, input(command, &id)).unwrap_err()["code"],
                        "app.lifecycle.closing"
                    );
                }
                // 正在安装时的原生关闭事件不退出，不重新解析身份。
                crate::native::close_requested(window.app_handle()).unwrap();
                release_tx.send(()).unwrap();
                let error = installer.join().unwrap().unwrap_err();
                assert_eq!(error["code"], INSTALL_FAILED.as_str());
            });
            assert!(lifecycle.exit.is_finished());
            assert!(matches!(
                state.native.updater.status().unwrap(),
                UpdateState::StoppedAfterInstallFailure { .. }
            ));
            // MockRuntime 的 is_visible/is_decorated 返回常量，显示与系统标题栏留给实机验收。
            for command in COMMANDS {
                assert_eq!(
                    invoke(window, command, input(command, &id)).unwrap_err()["code"],
                    "app.lifecycle.closing"
                );
            }
            assert_eq!(driver.installs.load(Ordering::SeqCst), 1);
            assert_eq!(
                std::fs::read(
                    driver
                        .scratch
                        .lock()
                        .unwrap()
                        .as_ref()
                        .unwrap()
                        .join("install-result.json")
                )
                .unwrap(),
                br#"{"code":"app.update.install_failed"}"#
            );
            // MockRuntime 未实现 request_exit；原生 × 的真实退出留给维护者实机验收。
        },
    );
}

#[test]
fn null_configuration_rejects_startup_check_and_rolls_back() {
    let name = "ipc_tests::updater::null_configuration_rejects_startup_check_and_rolls_back";
    if !boot::tests::child(name) {
        return;
    }
    let root = boot::tests::root();
    std::fs::write(
        root.path().join("config.toml"),
        "[updater]\ncheck_on_start=true\n",
    )
    .unwrap();
    let app = boot::tests::app();
    let lifecycle = Lifecycle::new();
    let error = tauri::async_runtime::block_on(boot::initialize(
        app.handle(),
        boot::Options {
            state_root: Some(root.path().into()),
            ..Default::default()
        },
        &lifecycle,
        boot::tests::ports(),
    ))
    .err()
    .unwrap();
    assert_eq!(error.code(), UNCONFIGURED);
    assert!(lifecycle.gate.is_closing());
    assert!(app.webview_windows().is_empty());
    assert!(!root.path().join("Temp/updates").exists());
}

#[test]
fn update_proxy_snapshot_reads_host_secrets_once_per_check() {
    use secrecy::ExposeSecret;
    let driver = Arc::new(Driver::default());
    with_driver(
        "ipc_tests::updater::update_proxy_snapshot_reads_host_secrets_once_per_check",
        driver.clone(),
        |_| {},
        |window, _| {
            let save = |password| {
                invoke(window, "app_network_settings_update", json!({"input":{
            "mode":"manual", "endpoint":"http://127.0.0.1:12345", "auth":true,
            "credentials":{"type":"replace", "username":"fixture-user", "password":password}
        }})).unwrap()
            };
            save("first-secret");
            let checked = invoke(window, "app_update_check", json!({})).unwrap();
            let id = checked["release"]["updateId"].as_str().unwrap();
            let snapshot = driver.proxy.lock().unwrap().clone().unwrap();
            save("second-secret");
            assert_eq!(
                invoke(
                    window,
                    "app_update_download",
                    input("app_update_download", id)
                )
                .unwrap()["status"],
                "verified"
            );
            assert!(Arc::ptr_eq(
                driver.proxy.lock().unwrap().as_ref().unwrap(),
                &snapshot
            ));
            let ProxySnapshot::Manual {
                endpoint,
                credentials: Some(credentials),
            } = snapshot.as_ref()
            else {
                panic!("manual snapshot")
            };
            assert_eq!(endpoint, "http://127.0.0.1:12345");
            assert_eq!(credentials.password.expose_secret(), "first-secret");
            invoke(window, "app_update_check", json!({})).unwrap();
            let current = driver.proxy.lock().unwrap();
            let ProxySnapshot::Manual {
                credentials: Some(credentials),
                ..
            } = current.as_ref().unwrap().as_ref()
            else {
                panic!("manual snapshot")
            };
            assert_eq!(credentials.password.expose_secret(), "second-secret");
            assert_eq!(driver.checks.load(Ordering::SeqCst), 2);
        },
    );
}
