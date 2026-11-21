//! demo 模块在宿主上的测试：样板附件和导入导出的文件令牌、导入导出任务、开发者模式开关，
//! 以及需要读取权限的参数。删 demo 时整个文件一起删。

use super::{DenyAll, DenyPermissions, file_data::token, invoke, with_host};
use crate::{boot, state::AppState};
use serde_json::{Value, json};
use std::{fs, sync::Arc, time::Duration};
use tauri::{Manager, WebviewWindow, test::MockRuntime};
use tenon_desktop::picked_files::FilePurpose;
use tenon_framework::actor::Actor;

const CONFIG: &str = "[ui]\ndeveloper_mode=true\n[notify]\ndesktop=false\n";

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
fn demo_attachments_resolve_single_use_tokens_to_paths() {
    with_host(
        "ipc_tests::demo::demo_attachments_resolve_single_use_tokens_to_paths",
        CONFIG,
        |_| {},
        |window, root| {
            let state = window.state::<AppState>();
            let actor = Actor::User(state.account.owner_id().unwrap());
            let source = root.join("input.txt");
            fs::write(&source, "host-token-boundary").unwrap();
            assert!(invoke(window, "demo_overview_get", json!({})).is_ok());
            let sample = invoke(
                window,
                "demo_sample_create",
                json!({"input":{"code":"host","title":"Host sample","note":"test"}}),
            )
            .unwrap();
            let token = state
                .picked_files
                .insert(actor, FilePurpose::Store, source.clone(), &["txt".into()])
                .unwrap()
                .token;
            let sample=invoke(window,"demo_attachment_add",json!({"input":{"id":sample["id"],"rowVersion":sample["rowVersion"],"fileToken":token}})).unwrap();
            assert_eq!(sample["attachment"]["name"], "input.txt");
            let destination = root.join("demo-copy.txt");
            let token = state
                .picked_files
                .insert(
                    actor,
                    FilePurpose::Save,
                    destination.clone(),
                    &["txt".into()],
                )
                .unwrap()
                .token;
            invoke(
                window,
                "demo_attachment_save",
                json!({"input":{"id":sample["id"],"fileToken":token}}),
            )
            .unwrap();
            assert_eq!(fs::read(&destination).unwrap(), fs::read(&source).unwrap());
            invoke(
                window,
                "app_settings_update",
                json!({"input":{"developerMode":false}}),
            )
            .unwrap();
            assert_eq!(
                invoke(window, "demo_overview_get", json!({})).unwrap_err()["code"],
                "demo.mode.disabled"
            );
        },
    );
}

#[test]
fn demo_exchange_permission_denial_precedes_token_consumption() {
    with_host(
        "ipc_tests::demo::demo_exchange_permission_denial_precedes_token_consumption",
        "",
        |state| state.identity.permission_checker = Arc::new(DenyAll),
        |window, root| {
            let state = window.state::<AppState>();
            let actor = Actor::User(state.account.owner_id().unwrap());
            for (command, purpose, name, extra) in [
                (
                    "demo_sample_export",
                    FilePurpose::Export,
                    "export.csv",
                    json!({"format":"csv"}),
                ),
                (
                    "demo_sample_import",
                    FilePurpose::Import,
                    "import.csv",
                    json!({"mode":"error"}),
                ),
            ] {
                let token = state
                    .picked_files
                    .insert(actor, purpose, root.join(name), &[])
                    .unwrap()
                    .token;
                let mut input = extra;
                input["fileToken"] = json!(token);
                assert_eq!(
                    invoke(window, command, json!({"input":input})).unwrap_err()["code"],
                    "app.permission.denied"
                );
                state
                    .picked_files
                    .take(&token, actor, purpose, None)
                    .unwrap();
            }
        },
    );
}

#[test]
fn demo_exchange_round_trips_jobs_with_only_internal_handles() {
    with_host(
        "ipc_tests::demo::demo_exchange_round_trips_jobs_with_only_internal_handles",
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
fn demo_exchange_submission_failure_consumes_selection_without_persisting_a_job() {
    with_host(
        "ipc_tests::demo::demo_exchange_submission_failure_consumes_selection_without_persisting_a_job",
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
fn demo_exchange_commands_are_main_only_and_reject_raw_path_inputs() {
    with_host(
        "ipc_tests::demo::demo_exchange_commands_are_main_only_and_reject_raw_path_inputs",
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
            for (command, body) in [
                (
                    "demo_sample_export",
                    json!({"input":{"fileToken":"id","format":"json"}}),
                ),
                (
                    "demo_sample_import",
                    json!({"input":{"fileToken":"id","mode":"error"}}),
                ),
            ] {
                assert!(invoke(&other, command, body).is_err(), "{command}");
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
fn demo_parameter_listing_and_writes_require_settings_permission() {
    with_host(
        "ipc_tests::demo::demo_parameter_listing_and_writes_require_settings_permission",
        "[ui]\ndeveloper_mode=true\n",
        |state| {
            state.identity.permission_lookup = Arc::new(DenyPermissions(&["demo.settings.manage"]));
        },
        |window, _| {
            for inspect in [true, false] {
                let entries = invoke(
                    window,
                    "app_setting_list",
                    json!({"input":{"includeDisabled":inspect}}),
                )
                .unwrap();
                assert!(
                    entries
                        .as_array()
                        .unwrap()
                        .iter()
                        .all(|p| p["key"] != "demo.batch_size")
                );
            }
            for command in ["app_setting_set", "app_setting_reset"] {
                let mut input = json!({"key":"demo.batch_size","rowVersion":null});
                if command == "app_setting_set" {
                    input["value"] = json!("5");
                }
                let error = invoke(window, command, json!({"input":input})).unwrap_err();
                assert_eq!(error["code"], "app.permission.denied");
                assert_eq!(error["params"]["permission"], "demo.settings.manage");
            }
        },
    );
}
