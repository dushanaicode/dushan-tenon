use super::{invoke, with_host};
use crate::state::AppState;
use serde_json::json;
use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::Manager;
use tenon_desktop::picked_files::FilePurpose;
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    error::AppError,
    ipc::{ActiveActor, ActorResolver},
};

struct CountingResolver {
    inner: Arc<dyn ActorResolver>,
    calls: Arc<AtomicUsize>,
}
impl ActorResolver for CountingResolver {
    fn resolve_active(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<ActiveActor, AppError>> + Send + '_>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.inner.resolve_active()
    }
    fn resolve_session(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Actor, AppError>> + Send + '_>> {
        self.inner.resolve_session()
    }
    fn resolve_public(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Actor>, AppError>> + Send + '_>> {
        self.inner.resolve_public()
    }
}

fn reauthenticate(name: &str, logout: bool) {
    let calls = Arc::new(AtomicUsize::new(0));
    with_host(
        name,
        "[notify]\ndesktop=false\n",
        |state| {
            state.identity.actor_resolver = Arc::new(CountingResolver {
                inner: state.identity.actor_resolver.clone(),
                calls: calls.clone(),
            });
        },
        |window, root| {
            invoke(
                window,
                "account_auth_enable_login",
                json!({"input":{"password":"maintenance-password"}}),
            )
            .unwrap();
            let state = window.state::<AppState>();
            let actor = Actor::User(state.account.owner_id().unwrap());
            let path = root.join("unchanged.tenon-backup.zip");
            std::fs::write(&path, "existing destination").unwrap();
            for command in [
                "app_backup_export",
                "app_backup_restore",
                "app_update_install",
            ] {
                let token = state
                    .picked_files
                    .insert(actor, FilePurpose::BackupExport, path.clone(), &[])
                    .unwrap()
                    .token;
                let input = match command {
                    "app_backup_export" => {
                        json!({"input":{"fileToken":token},"channel":"__CHANNEL__:98"})
                    }
                    "app_backup_restore" => {
                        json!({"input":{"preparedId":"0123456789abcdef0123456789abcdef"}})
                    }
                    "app_update_install" => {
                        json!({"input":{"updateId":"0123456789abcdef0123456789abcdef"}})
                    }
                    _ => panic!("unknown maintenance command: {command}"),
                };
                let permit = state.gate.enter().unwrap();
                calls.store(0, Ordering::SeqCst);
                let worker_window = window.clone();
                let worker = std::thread::spawn(move || invoke(&worker_window, command, input));
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    if state.gate.enter().is_err() {
                        break;
                    }
                    assert!(
                        Instant::now() < deadline,
                        "{command} did not wait for maintenance"
                    );
                    std::thread::sleep(Duration::from_millis(1));
                }
                assert_eq!(calls.load(Ordering::SeqCst), 1, "{command}");
                // 代表排空中的既有操作完成会话撤销；新 Normal IPC 此时不可进入。
                tauri::async_runtime::block_on(async {
                    if logout {
                        state
                            .account
                            .logout(&ExecutionContext::new(actor, "in-flight-logout"))
                            .await
                    } else {
                        state.account.lock().await
                    }
                })
                .unwrap();
                drop(permit);
                let error = worker.join().unwrap().unwrap_err();
                assert_eq!(
                    error["code"],
                    if logout {
                        "account.auth.required"
                    } else {
                        "account.session.locked"
                    },
                    "{command}: {error}"
                );
                assert_eq!(calls.load(Ordering::SeqCst), 2, "{command}");
                state
                    .picked_files
                    .take(&token, actor, FilePurpose::BackupExport, None)
                    .unwrap();
                assert_eq!(
                    std::fs::read_to_string(&path).unwrap(),
                    "existing destination"
                );
                assert!(!root.join("restore-journal.json").exists());
                assert!(!state.gate.is_closing());
                drop(state.gate.enter().unwrap());
                invoke(
                    window,
                    if logout {
                        "account_auth_login"
                    } else {
                        "account_session_unlock"
                    },
                    json!({"input":{"password":"maintenance-password"}}),
                )
                .unwrap();
            }
        },
    );
}

#[test]
fn maintenance_commands_recheck_session_after_lock_during_drain() {
    reauthenticate(
        "ipc_tests::maintenance::maintenance_commands_recheck_session_after_lock_during_drain",
        false,
    );
}

#[test]
fn maintenance_commands_recheck_session_after_logout_during_drain() {
    reauthenticate(
        "ipc_tests::maintenance::maintenance_commands_recheck_session_after_logout_during_drain",
        true,
    );
}
