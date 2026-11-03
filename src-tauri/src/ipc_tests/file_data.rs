use super::{invoke, with_host};
use crate::{boot, commands, lifecycle::Lifecycle, state::AppState};
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    Manager, WebviewWindow,
    ipc::{Channel, InvokeResponseBody},
    test::MockRuntime,
};
use tenon_desktop::picked_files::FilePurpose;
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::{Db, Table, select},
    stream::StreamEvent,
};

const CONFIG: &str = "[ui]\ndeveloper_mode=true\n[notify]\ndesktop=false\n";

fn token(window: &WebviewWindow<MockRuntime>, purpose: FilePurpose, path: &Path) -> String {
    let state = window.state::<AppState>();
    state
        .picked_files
        .insert(
            Actor::User(state.account.owner_id().unwrap()),
            purpose,
            path.into(),
            &[],
        )
        .unwrap()
        .token
}

fn archive(
    window: &WebviewWindow<MockRuntime>,
    command: &str,
    purpose: FilePurpose,
    path: &Path,
) -> Result<Value, Value> {
    invoke(
        window,
        command,
        json!({"input":{"fileToken":token(window, purpose, path)}, "channel":"__CHANNEL__:83"}),
    )
}

fn wait_job(window: &WebviewWindow<MockRuntime>, id: &Value) -> tenon_framework::job::JobSnapshot {
    tauri::async_runtime::block_on(async {
        let state = window.state::<AppState>();
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let job = state
                    .jobs
                    .get(serde_json::from_value(id.clone()).unwrap())
                    .await
                    .unwrap();
                if job.status.is_terminal() {
                    return job;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    })
}

#[test]
fn file_claim_recent_and_dismiss_never_expose_paths() {
    with_host(
        "ipc_tests::file_data::file_claim_recent_and_dismiss_never_expose_paths",
        CONFIG,
        |_| {},
        |window, root| {
            let file = root.join("private-folder-sentinel").join("sample.csv");
            fs::create_dir(file.parent().unwrap()).unwrap();
            fs::write(&file, "code,title,note\na,A,body\n").unwrap();
            let state = window.state::<AppState>();
            let lifecycle = window.state::<Arc<Lifecycle>>();
            crate::file_ingress::enqueue_arguments(
                window.app_handle(),
                &lifecycle,
                &[file.display().to_string()],
                root,
                None,
            );
            let snapshot = invoke(window, "app_file_ingress_list", json!({})).unwrap();
            assert!(!snapshot.to_string().contains("sentinel"));
            let id = &snapshot["pending"][0]["id"];
            let picked = invoke(
                window,
                "app_file_ingress_claim",
                json!({"input":{"id":id,"purpose":"import"}}),
            )
            .unwrap();
            assert_eq!(picked["fileName"], "sample.csv");
            assert!(
                invoke(
                    window,
                    "app_file_ingress_claim",
                    json!({"input":{"id":id,"purpose":"import"}})
                )
                .is_err()
            );
            let actor = Actor::User(state.account.owner_id().unwrap());
            assert_eq!(
                state
                    .picked_files
                    .take(
                        picked["token"].as_str().unwrap(),
                        actor,
                        FilePurpose::Import,
                        None
                    )
                    .unwrap()
                    .path,
                file.canonicalize().unwrap()
            );
            let snapshot = invoke(window, "app_file_ingress_list", json!({})).unwrap();
            assert!(snapshot["pending"].as_array().unwrap().is_empty());
            invoke(
                window,
                "app_file_recent_open",
                json!({"input":{"id":snapshot["recent"][0]["id"]}}),
            )
            .unwrap();
            let snapshot = invoke(window, "app_file_ingress_list", json!({})).unwrap();
            invoke(
                window,
                "app_file_ingress_dismiss",
                json!({"input":{"ids":[snapshot["pending"][0]["id"]],"clearRecent":true}}),
            )
            .unwrap();
            let snapshot = invoke(window, "app_file_ingress_list", json!({})).unwrap();
            assert!(snapshot["pending"].as_array().unwrap().is_empty());
            assert!(snapshot["recent"].as_array().unwrap().is_empty());
            assert!(
                invoke(
                    window,
                    "app_file_recent_open",
                    json!({"input":{"path":file}})
                )
                .is_err()
            );
        },
    );
}

#[test]
fn exchange_commands_round_trip_jobs_with_only_internal_handles() {
    with_host(
        "ipc_tests::file_data::exchange_commands_round_trip_jobs_with_only_internal_handles",
        CONFIG,
        |_| {},
        |window, _| {
            let output = boot::tests::root();
            let path = output.path().join("private-exchange-sentinel.json");
            let sample = invoke(
                window,
                "demo_sample_create",
                json!({"input":{"code":"exported","title":"Exported","note":"round trip"}}),
            )
            .unwrap();
            let picked = token(window, FilePurpose::Export, &path);
            let job = invoke(
                window,
                "demo_sample_export",
                json!({"input":{"fileToken":picked,"format":"json"}}),
            )
            .unwrap();
            let done = wait_job(window, &job["jobId"]);
            assert_eq!(done.status, tenon_framework::job::JobStatus::Succeeded);
            assert!(!done.payload.to_string().contains("sentinel"));
            assert_ne!(done.payload["handle"], picked);
            assert!(done.payload.get("path").is_none());
            assert!(
                invoke(
                    window,
                    "demo_sample_export",
                    json!({"input":{"fileToken":picked,"format":"json"}})
                )
                .is_err()
            );
            invoke(
                window,
                "demo_sample_delete",
                json!({"input":{"id":sample["id"],"rowVersion":sample["rowVersion"]}}),
            )
            .unwrap();
            let job = invoke(window, "demo_sample_import", json!({"input":{"fileToken":token(window, FilePurpose::Import, &path),"mode":"error"}})).unwrap();
            let done = wait_job(window, &job["jobId"]);
            assert_eq!(done.status, tenon_framework::job::JobStatus::Succeeded);
            assert!(done.payload["format"].is_null());
            assert!(!done.payload.to_string().contains("sentinel"));
            assert_eq!(
                invoke(window, "demo_overview_get", json!({})).unwrap()["total"],
                1
            );
        },
    );
}

#[test]
fn about_paths_use_native_separators_and_match_live_storage() {
    with_host(
        "ipc_tests::file_data::about_paths_use_native_separators_and_match_live_storage",
        CONFIG,
        |_| {},
        |window, root| {
            let about = invoke(window, "app_about_get", json!({})).unwrap();
            let sep = std::path::MAIN_SEPARATOR;
            for (field, suffix) in [
                ("stateRoot", String::new()),
                ("configFile", format!("{sep}config.toml")),
                ("logDirectory", format!("{sep}logs")),
                ("databaseLocation", format!("{sep}data{sep}app.db")),
            ] {
                assert_eq!(about[field], format!("{}{suffix}", root.display()));
            }
            assert!(Path::new(about["databaseLocation"].as_str().unwrap()).is_file());
        },
    );
}

#[test]
fn diagnostics_requires_probe_and_exports_only_whitelisted_facts() {
    with_host(
        "ipc_tests::file_data::diagnostics_requires_probe_and_exports_only_whitelisted_facts",
        CONFIG,
        |_| {},
        |window, root| {
            let output = boot::tests::root();
            let path = output.path().join("report.tenon-diagnostics.zip");
            fs::write(
                root.join("private-secret-sentinel"),
                "private-secret-sentinel",
            )
            .unwrap();
            let picked = token(window, FilePurpose::DiagnosticsExport, &path);
            let input = json!({"input":{"fileToken":picked}});
            assert_eq!(
                invoke(window, "app_diagnostics_export", input.clone()).unwrap_err()["code"],
                "app.diagnostics.needs_probe"
            );
            assert!(!path.exists());
            invoke(window, "app_about_get", json!({})).unwrap();
            let artifact = invoke(window, "app_diagnostics_export", input.clone()).unwrap();
            let bytes = fs::read(&path).unwrap();
            assert_eq!(artifact["bytes"], bytes.len());
            assert_eq!(artifact["sha256"].as_str().unwrap().len(), 64);
            let content = String::from_utf8_lossy(&bytes);
            assert!(content.contains("diagnostics.txt"));
            assert!(content.contains("cache.status: connected"));
            assert!(content.contains("paths: [redacted]\nendpoints: [redacted]"));
            assert!(!content.contains("sentinel"));
            assert!(!content.contains(root.to_str().unwrap()));
            assert!(invoke(window, "app_diagnostics_export", input).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
            let state = window.state::<AppState>();
            *state.diagnostics_probe.lock().unwrap() =
                Some(tenon_desktop::diagnostics::CacheStatus::Error {
                    code: tenon_framework::cache::CACHE_UNAVAILABLE,
                });
            let text =
                tenon_desktop::diagnostics::render(&crate::diagnostics::snapshot(&state).unwrap())
                    .unwrap();
            assert!(text.contains("cache.errorCode: app.cache.unavailable"));
            assert_eq!(
                invoke(window, "app_data_status", json!({})).unwrap()["canManage"],
                true
            );
        },
    );
}

#[test]
fn backup_timeout_releases_maintenance_and_keeps_selection_unconsumed() {
    with_host(
        "ipc_tests::file_data::backup_timeout_releases_maintenance_and_keeps_selection_unconsumed",
        CONFIG,
        |_| {},
        |window, _| {
            let state = window.state::<AppState>();
            let output = boot::tests::root();
            let path = output.path().join("timeout.tenon-backup.zip");
            let picked = token(window, FilePurpose::BackupExport, &path);
            let permit = state.gate.enter().unwrap();
            let start = Instant::now();
            let result = invoke(
                window,
                "app_backup_export",
                json!({"input":{"fileToken":picked},"channel":"__CHANNEL__:82"}),
            );
            assert_eq!(result.unwrap_err()["code"], "app.operation.busy");
            assert!(start.elapsed() >= Duration::from_secs(5));
            assert!(!path.exists());
            drop(permit);
            assert!(state.gate.enter().is_ok());
            state
                .picked_files
                .take(
                    &picked,
                    Actor::User(state.account.owner_id().unwrap()),
                    FilePurpose::BackupExport,
                    None,
                )
                .unwrap();
        },
    );
}

#[test]
fn backup_cancel_uses_control_during_maintenance_and_preserves_destination() {
    with_host(
        "ipc_tests::file_data::backup_cancel_uses_control_during_maintenance_and_preserves_destination",
        CONFIG,
        |_| {},
        |window, _| {
            let output = boot::tests::root();
            let path = output.path().join("cancel.tenon-backup.zip");
            fs::write(&path, "original target").unwrap();
            let selected = token(window, FilePurpose::BackupExport, &path);
            let app = window.app_handle().clone();
            let events = Arc::new(Mutex::new(Vec::new()));
            let captured = events.clone();
            let channel =
                Channel::<StreamEvent<tenon_desktop::data::OperationProgress>>::new(move |event| {
                    let InvokeResponseBody::Json(body) = event else {
                        panic!("JSON event")
                    };
                    let value: Value = serde_json::from_str(&body).unwrap();
                    if let Some(id) = value
                        .get("data")
                        .and_then(|data| data.get("operationId"))
                        .and_then(Value::as_str)
                    {
                        std::thread::scope(|scope| {
                            scope
                                .spawn(|| {
                                    tauri::async_runtime::block_on(
                                        commands::app_operation_cancel::app_operation_cancel(
                                            app.state(),
                                            dushan_tenon_lib::contract::OperationCancelInput {
                                                operation_id: id.into(),
                                            },
                                        ),
                                    )
                                    .unwrap();
                                })
                                .join()
                                .unwrap()
                        });
                    }
                    captured.lock().unwrap().push(value);
                    Ok(())
                });
            let result =
                tauri::async_runtime::block_on(commands::app_backup_export::app_backup_export(
                    window.clone(),
                    window.state(),
                    dushan_tenon_lib::contract::ArchiveOperationInput {
                        file_token: selected,
                    },
                    channel,
                ));
            assert_eq!(result.err().unwrap().code, "app.backup.cancelled");
            assert_eq!(fs::read_to_string(path).unwrap(), "original target");
            assert!(!events.lock().unwrap().is_empty());
            assert!(window.state::<AppState>().gate.enter().is_ok());
        },
    );
}

#[test]
fn restore_commits_after_module_validation_then_closes_before_restart() {
    with_host(
        "ipc_tests::file_data::restore_commits_after_module_validation_then_closes_before_restart",
        CONFIG,
        |_| {},
        |window, root| {
            let state = window.state::<AppState>();
            let output = boot::tests::root();
            let archive_path = output.path().join("copy.tenon-backup.zip");
            let actor = Actor::User(state.account.owner_id().unwrap());
            tauri::async_runtime::block_on(state.params.set(
                &ExecutionContext::new(actor, "test"),
                "demo.batch_size",
                "17",
                None,
            ))
            .unwrap();
            let original_instance = fs::read(root.join("instance-id")).unwrap();
            let artifact = archive(
                window,
                "app_backup_export",
                FilePurpose::BackupExport,
                &archive_path,
            )
            .unwrap();
            assert_eq!(
                artifact["bytes"],
                fs::metadata(&archive_path).unwrap().len()
            );
            let plan = archive(
                window,
                "app_backup_prepare_restore",
                FilePurpose::BackupRestore,
                &archive_path,
            )
            .unwrap();
            assert!(!root.join("restore-journal.json").exists());
            assert_eq!(plan["requiresRestart"], true);
            assert!(state.gate.enter().is_ok());
            assert!(
                tauri::async_runtime::block_on(state.params.entries())
                    .unwrap()
                    .iter()
                    .any(|entry| entry.key == "demo.batch_size"
                        && entry.value.as_deref() == Some("17"))
            );
            let accepted = invoke(
                window,
                "app_backup_restore",
                json!({"input":{"preparedId":plan["preparedId"]}}),
            )
            .unwrap();
            assert_eq!(accepted["restartRequired"], true);
            assert!(root.join("restore-journal.json").is_file());
            assert!(state.gate.is_closing());
            let lifecycle = window.state::<Arc<Lifecycle>>();
            tauri::async_runtime::block_on(async {
                tokio::time::timeout(Duration::from_secs(5), async {
                    while !lifecycle.exit.is_finished() {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                assert!(state.db.begin().await.is_err());
            });
            lifecycle
                .recovery_ui
                .restart_with(|args| {
                    assert!(lifecycle.exit.is_finished());
                    assert!(args.contains(&"--restore-prepared".into()));
                    assert!(args.contains(&accepted["operationId"].as_str().unwrap().into()));
                    Ok(())
                })
                .unwrap();
            // 模拟新进程的启动恢复，不启动真实进程；只触碰隔离目录。
            tenon_desktop::restore::before_start(
                root,
                &root.join("Temp/restore"),
                accepted["operationId"].as_str(),
            )
            .unwrap();
            assert_eq!(
                fs::read(root.join("instance-id")).unwrap(),
                original_instance
            );
            let last =
                serde_json::to_value(tenon_desktop::restore::last_result(root).unwrap()).unwrap();
            assert_eq!(last["status"], "succeeded");
            tauri::async_runtime::block_on(async {
                let db = Db::open_sqlite(root.join("data/app.db")).await.unwrap();
                let query = select(Table {
                    name: "fw_param",
                    audit: true,
                    soft_delete: false,
                    optimistic_lock: true,
                })
                .into_query()
                .clear_selects()
                .columns(["param_key", "value"])
                .to_owned();
                let values: Vec<(String, Option<String>)> = db.fetch_all(&query).await.unwrap();
                assert!(
                    values
                        .iter()
                        .any(|(key, value)| key == "demo.batch_size"
                            && value.as_deref() == Some("17"))
                );
                db.close().await;
            });
        },
    );
}

#[test]
fn restore_rejects_invalid_account_hashes_without_touching_live_database() {
    with_host(
        "ipc_tests::file_data::restore_rejects_invalid_account_hashes_without_touching_live_database",
        CONFIG,
        |_| {},
        |window, root| {
            let state = window.state::<AppState>();
            let owner = state.account.owner_id().unwrap();
            tauri::async_runtime::block_on(state.db.update_by_id(
                Table {
                    name: "account_user",
                    audit: true,
                    soft_delete: false,
                    optimistic_lock: true,
                },
                &ExecutionContext::new(Actor::System, "test"),
                owner,
                Some(1),
                [("password_hash", "invalid-hash".into())],
            ))
            .unwrap();
            let output = boot::tests::root();
            let path = output.path().join("invalid.tenon-backup.zip");
            archive(
                window,
                "app_backup_export",
                FilePurpose::BackupExport,
                &path,
            )
            .unwrap();
            assert_eq!(
                archive(
                    window,
                    "app_backup_prepare_restore",
                    FilePurpose::BackupRestore,
                    &path
                )
                .unwrap_err()["code"],
                "app.backup.invalid_archive"
            );
            assert!(!root.join("restore-journal.json").exists());
            assert!(state.gate.enter().is_ok());
            tauri::async_runtime::block_on(async {
                state.db.begin().await.unwrap().rollback().await.unwrap();
            });
        },
    );
}

#[test]
fn all_file_commands_are_main_only_and_reject_raw_path_inputs() {
    with_host(
        "ipc_tests::file_data::all_file_commands_are_main_only_and_reject_raw_path_inputs",
        CONFIG,
        |_| {},
        |window, _| {
            let other = tauri::WebviewWindowBuilder::new(
                window.app_handle(),
                "other",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .build()
            .unwrap();
            let requests = [
                ("app_file_pick", json!({"input":{"purpose":"import"}})),
                ("app_file_ingress_list", json!({})),
                (
                    "app_file_ingress_claim",
                    json!({"input":{"id":"id","purpose":"import"}}),
                ),
                (
                    "app_file_ingress_dismiss",
                    json!({"input":{"ids":[],"clearRecent":false}}),
                ),
                ("app_file_recent_open", json!({"input":{"id":"id"}})),
                ("app_data_status", json!({})),
                (
                    "app_backup_export",
                    json!({"input":{"fileToken":"id"},"channel":"__CHANNEL__:1"}),
                ),
                (
                    "app_backup_prepare_restore",
                    json!({"input":{"fileToken":"id"},"channel":"__CHANNEL__:1"}),
                ),
                (
                    "app_backup_restore",
                    json!({"input":{"preparedId":"0123456789abcdef0123456789abcdef"}}),
                ),
                (
                    "app_diagnostics_export",
                    json!({"input":{"fileToken":"id"}}),
                ),
                (
                    "demo_sample_export",
                    json!({"input":{"fileToken":"id","format":"json"}}),
                ),
                (
                    "demo_sample_import",
                    json!({"input":{"fileToken":"id","mode":"error"}}),
                ),
            ];
            for (command, body) in requests {
                assert!(invoke(&other, command, body).is_err(), "{command}");
            }
            let state = window.state::<AppState>();
            for owner in [
                tenon_framework::stream::StreamOwner {
                    actor: Actor::User(state.account.owner_id().unwrap()),
                    scope: "other".into(),
                },
                tenon_framework::stream::StreamOwner {
                    actor: Actor::User(tenon_framework::id::Id::new()),
                    scope: "main".into(),
                },
            ] {
                assert!(crate::data::require_owner(&state, &owner).is_err());
            }
            for command in [
                "app_backup_export",
                "app_backup_prepare_restore",
                "app_diagnostics_export",
                "demo_sample_import",
                "demo_sample_export",
            ] {
                assert!(
                    invoke(
                        window,
                        command,
                        json!({"input":{"path":"private.csv"},"channel":"__CHANNEL__:1"})
                    )
                    .is_err()
                );
            }
        },
    );
}

#[test]
fn exchange_submission_failure_consumes_selection_without_persisting_a_job() {
    with_host(
        "ipc_tests::file_data::exchange_submission_failure_consumes_selection_without_persisting_a_job",
        CONFIG,
        |state| {
            state.jobs = tenon_framework::job::JobQueue::new(
                state.db.clone(),
                vec![],
                vec![],
                vec![],
                state.instance,
            )
            .unwrap();
        },
        |window, root| {
            let path = root.join("failure.json");
            let picked = token(window, FilePurpose::Export, &path);
            assert!(
                invoke(
                    window,
                    "demo_sample_export",
                    json!({"input":{"fileToken":picked,"format":"json"}})
                )
                .is_err()
            );
            let state = window.state::<AppState>();
            assert!(
                state
                    .picked_files
                    .take(
                        &picked,
                        Actor::User(state.account.owner_id().unwrap()),
                        FilePurpose::Export,
                        None
                    )
                    .is_err()
            );
            assert!(!path.exists());
            let jobs = invoke(
                window,
                "devtools_job_list",
                json!({"input":{"page":1,"pageSize":20}}),
            )
            .unwrap();
            assert_eq!(jobs["total"], 0);
        },
    );
}

#[test]
fn drop_and_secondary_launch_notify_only_the_matching_open_host() {
    with_host(
        "ipc_tests::file_data::drop_and_secondary_launch_notify_only_the_matching_open_host",
        CONFIG,
        |_| {},
        |window, root| {
            let lifecycle = window.state::<Arc<Lifecycle>>();
            let file = root.join("dropped.csv");
            fs::write(&file, "code,title,note\n").unwrap();
            let events = Arc::new(Mutex::new(Vec::new()));
            let captured = events.clone();
            tauri::async_runtime::block_on(commands::app_window_watch::app_window_watch(
                window.state(),
                window.clone(),
                Channel::new(move |event| {
                    let InvokeResponseBody::Json(body) = event else {
                        panic!("raw JSON")
                    };
                    captured
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str::<Value>(&body).unwrap());
                    Ok(())
                }),
            ))
            .unwrap();
            crate::application::handle_window_event(
                window.app_handle(),
                "main",
                tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {
                    paths: vec![file.clone()],
                    position: tauri::PhysicalPosition::new(0.0, 0.0),
                }),
                &lifecycle,
            );
            assert!(
                events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|event| event["type"] == "files_changed")
            );
            let count = || {
                lifecycle
                    .file_ingress
                    .list(root, window.state::<AppState>().account.owner_id().unwrap())
                    .unwrap()
                    .pending
                    .len()
            };
            assert_eq!(count(), 1);
            let other = boot::tests::root();
            crate::window::secondary_launch(
                window.app_handle(),
                vec![
                    "app".into(),
                    "--state-root".into(),
                    other.path().display().to_string(),
                    file.display().to_string(),
                ],
                root.display().to_string(),
                &lifecycle,
            );
            assert_eq!(count(), 1);
            crate::window::secondary_launch(
                window.app_handle(),
                vec![
                    "app".into(),
                    "--state-root".into(),
                    root.display().to_string(),
                    "--set".into(),
                    "auth.mode=login".into(),
                    file.display().to_string(),
                ],
                root.display().to_string(),
                &lifecycle,
            );
            assert_eq!(count(), 2);
            assert_eq!(
                invoke(window, "account_auth_status", json!({})).unwrap()["mode"],
                "none"
            );
            lifecycle.exit.begin();
            crate::application::handle_window_event(
                window.app_handle(),
                "main",
                tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {
                    paths: vec![file],
                    position: tauri::PhysicalPosition::new(0.0, 0.0),
                }),
                &lifecycle,
            );
            assert_eq!(count(), 2);
        },
    );
}
