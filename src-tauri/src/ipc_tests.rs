use crate::{boot, lifecycle::Lifecycle, state::AppState};
use dushan_tenon_lib::contract::*;
use serde_json::{Value, json};
use std::{collections::BTreeSet, fs, path::Path, sync::Arc};
use tauri::{
    Manager, WebviewUrl, WebviewWindow,
    ipc::{CallbackFn, InvokeBody},
    test::{INVOKE_KEY, MockRuntime, get_ipc_response},
    webview::InvokeRequest,
};
use tenon_framework::{actor::Actor, id::Id, ipc::IpcContext};

fn with_host(
    name: &str,
    config: &str,
    prepare: impl FnOnce(&mut AppState),
    test: impl FnOnce(&WebviewWindow<MockRuntime>, &Path),
) {
    if !boot::tests::child(name) {
        return;
    }
    let root = boot::tests::root();
    fs::write(root.path().join("config.toml"), config).unwrap();
    let app = boot::tests::app();
    let lifecycle = Arc::new(Lifecycle::new());
    let mut running = tauri::async_runtime::block_on(boot::initialize(
        app.handle(),
        boot::Options {
            state_root: Some(root.path().into()),
            ..Default::default()
        },
        &lifecycle,
        boot::tests::ports(),
    ))
    .unwrap();
    prepare(&mut running.state);
    let shutdown = running.shutdown;
    app.manage(running.state);
    let window =
        tauri::WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
            .build()
            .unwrap();
    test(&window, root.path());
    tauri::async_runtime::block_on(shutdown.shutdown());
}

fn invoke(window: &WebviewWindow<MockRuntime>, command: &str, body: Value) -> Result<Value, Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: command.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: window.url().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .map(|response| response.deserialize().unwrap())
}

#[test]
fn main_capability_grants_exactly_application_commands() {
    let capability: Value =
        serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    let permissions = capability["permissions"].as_array().unwrap();
    let actual: BTreeSet<_> = permissions
        .iter()
        .map(|p| p.as_str().unwrap().to_owned())
        .collect();
    let expected: BTreeSet<_> = COMMAND_NAMES
        .iter()
        .map(|name| format!("allow-{}", name.replace('_', "-")))
        .collect();
    assert_eq!(actual.len(), permissions.len());
    assert_eq!(actual, expected);
    assert_eq!(capability["windows"], json!(["main"]));
    assert!(capability.get("webviews").is_none());
    assert!(capability.get("remote").is_none());
    let generated: Value = serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/command-permissions.json"
    )))
    .unwrap();
    let entries = generated["permission"].as_array().unwrap();
    assert_eq!(entries.len(), COMMAND_NAMES.len() * 2);
    for (index, name) in COMMAND_NAMES.iter().enumerate() {
        for (offset, rule) in ["allow", "deny"].iter().enumerate() {
            assert_eq!(
                entries[index * 2 + offset]["identifier"],
                format!("{rule}-{}", name.replace('_', "-"))
            );
            assert_eq!(
                entries[index * 2 + offset]["commands"],
                json!({*rule:[name]})
            );
        }
    }
}

#[test]
fn command_access_and_implementations_match_the_three_entry_contracts() {
    let public = COMMAND_ACCESS
        .iter()
        .filter(|(_, level)| *level == "execute_public")
        .map(|(name, _)| *name)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        public,
        BTreeSet::from([
            "account_auth_status",
            "account_auth_login",
            "account_auth_captcha",
            "account_auth_recover",
            "account_auth_initialize",
            "account_auth_confirm_mode",
            "app_settings_get",
            "app_settings_update"
        ])
    );
    let session = COMMAND_ACCESS
        .iter()
        .filter(|(_, level)| *level == "execute_session")
        .map(|(name, _)| *name)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        session,
        BTreeSet::from([
            "account_auth_logout",
            "account_session_lock",
            "account_session_unlock",
            "account_session_touch"
        ])
    );
    for (name, level) in COMMAND_ACCESS {
        let source = fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("src/commands/{name}.rs")),
        )
        .unwrap();
        assert!(source.contains(&format!("ipc::{level}(")), "{name}");
        assert!(source.contains(&format!("stringify!({name})")), "{name}");
    }
    assert_eq!(
        COMMAND_ADMISSION
            .iter()
            .filter(|(_, kind)| *kind == CommandAdmission::Control)
            .map(|(name, _)| *name)
            .collect::<Vec<_>>(),
        ["app_operation_cancel"]
    );
    assert!(
        COMMAND_NAMES
            .iter()
            .all(|name| !name.contains("background"))
    );
}

#[test]
fn application_commands_round_trip_settings_parameters_and_modules() {
    with_host(
        "ipc_tests::application_commands_round_trip_settings_parameters_and_modules",
        "[ui]\ndeveloper_mode=true\n[notify]\ndesktop=false\n",
        |_| {},
        |window, root| {
            let settings = invoke(window, "app_settings_get", json!({})).unwrap();
            assert!(settings.get("background").is_none());
            let updated = invoke(
                window,
                "app_settings_update",
                json!({"input":{"theme":"dark","language":"en-US"}}),
            )
            .unwrap();
            assert_eq!(updated["theme"]["value"], "dark");
            assert_eq!(updated["theme"]["source"], "file");
            assert!(
                fs::read_to_string(root.join("config.toml"))
                    .unwrap()
                    .contains("dark")
            );
            assert!(
                invoke(
                    window,
                    "app_settings_update",
                    json!({"input":{"background":"image"}})
                )
                .is_err()
            );
            let modules = invoke(window, "app_modules_list", json!({})).unwrap();
            assert_eq!(
                modules["modules"].as_array().unwrap().len(),
                crate::modules::DECLARATIONS.len()
            );
            let params = invoke(
                window,
                "app_setting_list",
                json!({"input":{"includeDisabled":false}}),
            )
            .unwrap();
            let entry = params
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["key"] == "account.idle_lock_minutes")
                .unwrap();
            let changed = invoke(
                window,
                "app_setting_set",
                json!({"input":{"key":entry["key"],"value":"5","rowVersion":entry["rowVersion"]}}),
            )
            .unwrap();
            assert_eq!(changed["value"], "5");
            let reset = invoke(
                window,
                "app_setting_reset",
                json!({"input":{"key":entry["key"],"rowVersion":changed["rowVersion"]}}),
            )
            .unwrap();
            assert_eq!(reset["isDefault"], true);
            assert_eq!(invoke(window, "notify_unread_count", json!({})).unwrap(), 0);
            assert!(invoke(window, "account_user_me", json!({})).is_ok());
            assert!(
                invoke(window, "devtools_schedule_list", json!({}))
                    .unwrap()
                    .is_array()
            );
            assert_eq!(
                invoke(window, "app_about_get", json!({})).unwrap()["cacheStatus"]["status"],
                "connected"
            );
            let state = window.state::<AppState>();
            assert_eq!(
                crate::modules::migrations()
                    .iter()
                    .map(|m| m.info.module)
                    .collect::<Vec<_>>(),
                state
                    .modules
                    .migrations()
                    .iter()
                    .map(|m| m.info.module)
                    .collect::<Vec<_>>()
            );
        },
    );
}

#[test]
fn module_guard_precedes_identity_and_control_remains_available_when_locked() {
    with_host(
        "ipc_tests::module_guard_precedes_identity_and_control_remains_available_when_locked",
        "[auth]\nmode='login'\n[modules.demo]\nenabled=false\n",
        |_| {},
        |window, _| {
            assert_eq!(
                invoke(window, "demo_overview_get", json!({})).unwrap_err()["code"],
                "app.module.disabled"
            );
            assert!(invoke(window, "account_auth_status", json!({})).is_ok());
            assert!(invoke(window, "app_settings_get", json!({})).is_ok());
            assert!(invoke(window, "account_user_me", json!({})).is_err());
            assert!(
                invoke(
                    window,
                    "app_settings_update",
                    json!({"input":{"developerMode":true}})
                )
                .is_err()
            );
            assert!(
                invoke(
                    window,
                    "app_operation_cancel",
                    json!({"input":{"operationId":"0123456789abcdef0123456789abcdef"}})
                )
                .is_ok()
            );
            let state = window.state::<AppState>();
            state.gate.close_admission();
            assert_eq!(
                invoke(
                    window,
                    "app_operation_cancel",
                    json!({"input":{"operationId":"0123456789abcdef0123456789abcdef"}})
                )
                .unwrap_err()["code"],
                "app.lifecycle.closing"
            );
        },
    );
}

#[test]
fn file_and_demo_commands_resolve_single_use_tokens_to_paths() {
    with_host(
        "ipc_tests::file_and_demo_commands_resolve_single_use_tokens_to_paths",
        "[ui]\ndeveloper_mode=true\n",
        |_| {},
        |window, root| {
            use tenon_desktop::picked_files::FilePurpose;
            let state = window.state::<AppState>();
            let actor = Actor::User(state.account.owner_id().unwrap());
            let source = root.join("input.txt");
            fs::write(&source, "host-token-boundary").unwrap();
            let token = state
                .picked_files
                .insert(actor, FilePurpose::Store, source.clone(), &["txt".into()])
                .unwrap()
                .token;
            let input = json!({"input":{"purpose":"files.attachment","fileToken":token}});
            let file = invoke(window, "files_file_add", input.clone()).unwrap();
            assert_eq!(file["originalName"], "input.txt");
            assert!(!file.to_string().contains(&root.display().to_string()));
            assert_eq!(
                invoke(window, "files_file_add", input).unwrap_err()["code"],
                "app.exchange.file_token_invalid"
            );
            let destination = root.join("copied.txt");
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
                "files_file_save_copy",
                json!({"input":{"id":file["id"],"fileToken":token}}),
            )
            .unwrap();
            assert_eq!(fs::read(&destination).unwrap(), fs::read(&source).unwrap());
            for (owner, purpose) in [
                (Actor::User(Id::new()), FilePurpose::Store),
                (actor, FilePurpose::Save),
            ] {
                let token = state
                    .picked_files
                    .insert(owner, purpose, source.clone(), &["txt".into()])
                    .unwrap()
                    .token;
                assert_eq!(
                    invoke(
                        window,
                        "files_file_add",
                        json!({"input":{"purpose":"files.attachment","fileToken":token}})
                    )
                    .unwrap_err()["code"],
                    "app.exchange.file_token_invalid"
                );
            }
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
fn command_permission_denial_precedes_token_consumption() {
    struct Deny;
    impl tenon_framework::ipc::PermissionChecker for Deny {
        fn check(
            &self,
            _: &tenon_framework::ipc::ActiveActor,
            key: &str,
        ) -> Result<(), tenon_framework::error::AppError> {
            Err(
                tenon_framework::error::AppError::new(tenon_framework::error::PERMISSION_DENIED)
                    .with_param("permission", key),
            )
        }
    }
    with_host(
        "ipc_tests::command_permission_denial_precedes_token_consumption",
        "",
        |state| state.identity.permission_checker = Arc::new(Deny),
        |window, root| {
            use tenon_desktop::picked_files::FilePurpose;
            let state = window.state::<AppState>();
            let actor = Actor::User(state.account.owner_id().unwrap());
            let source = root.join("private.txt");
            let token = state
                .picked_files
                .insert(actor, FilePurpose::Store, source, &["txt".into()])
                .unwrap()
                .token;
            assert_eq!(
                invoke(
                    window,
                    "files_file_add",
                    json!({"input":{"purpose":"files.attachment","fileToken":token}})
                )
                .unwrap_err()["code"],
                "app.permission.denied"
            );
            assert!(
                state
                    .picked_files
                    .take(&token, actor, FilePurpose::Store, None)
                    .is_ok()
            );
            assert_eq!(
                state.required_permissions("ai_service_test"),
                ["ai.service.manage", "ai.chat.use"]
            );
            assert_eq!(
                invoke(window, "ai_service_test", json!({})).unwrap_err()["code"],
                "app.permission.denied"
            );
        },
    );
}
