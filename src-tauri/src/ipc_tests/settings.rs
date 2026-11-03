use super::*;
use serde_json::json;

#[test]
fn parameter_inputs_versions_and_disabled_modules_are_enforced() {
    with_host(
        "ipc_tests::settings::parameter_inputs_versions_and_disabled_modules_are_enforced",
        "[modules.demo]\nenabled=false\n",
        |_| {},
        |window, _| {
            for command in ["app_setting_set", "app_setting_reset"] {
                for (key, version, code, path) in [
                    (
                        "account.idle_lock_minutes",
                        0_i64,
                        "app.input.invalid",
                        Some("rowVersion"),
                    ),
                    (
                        "account.idle_lock_minutes",
                        -1,
                        "app.input.invalid",
                        Some("rowVersion"),
                    ),
                    (
                        "account.idle_lock_minutes",
                        9_007_199_254_740_992,
                        "app.input.invalid",
                        Some("rowVersion"),
                    ),
                    ("unknown.setting", 1, "app.input.invalid", Some("key")),
                    ("demo.batch_size", 1, "app.module.disabled", None),
                ] {
                    let mut input = json!({"key":key,"rowVersion":version});
                    if command == "app_setting_set" {
                        input["value"] = json!("5");
                    }
                    let error = invoke(window, command, json!({"input":input})).unwrap_err();
                    assert_eq!(error["code"], code);
                    if let Some(path) = path {
                        assert_eq!(error["params"]["path"], path);
                    }
                }
                let mut input = json!({"key":"account.idle_lock_minutes","extra":true});
                if command == "app_setting_set" {
                    input["value"] = json!("5");
                }
                assert!(invoke(window, command, json!({"input":input})).is_err());
            }
            assert!(
                invoke(
                    window,
                    "app_setting_list",
                    json!({"input":{"includeDisabled":false,"extra":true}})
                )
                .is_err()
            );
            let input =
                json!({"input":{"key":"account.idle_lock_minutes","value":"5","rowVersion":null}});
            let saved = invoke(window, "app_setting_set", input.clone()).unwrap();
            assert_eq!(saved["source"], "database");
            assert_eq!(saved["rowVersion"], 1);
            assert_eq!(
                invoke(window, "app_setting_set", input).unwrap_err()["code"],
                "app.data.version_conflict"
            );
            let reset_input = json!({"input":{"key":"account.idle_lock_minutes","rowVersion":1}});
            let reset = invoke(window, "app_setting_reset", reset_input.clone()).unwrap();
            assert_eq!(reset["source"], "default");
            assert!(reset["rowVersion"].is_null());
            assert_eq!(
                invoke(window, "app_setting_reset", reset_input).unwrap_err()["code"],
                "app.data.version_conflict"
            );
        },
    );
}

#[test]
fn parameter_listing_and_writes_check_each_declared_permission() {
    struct DenySettings;
    impl tenon_framework::job::PermissionLookup for DenySettings {
        fn has_permission<'a>(
            &'a self,
            _: tenon_framework::actor::Actor,
            key: &'a str,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<bool, tenon_framework::error::AppError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                Ok(!matches!(
                    key,
                    "demo.settings.manage" | "account.security.manage"
                ))
            })
        }
    }
    with_host(
        "ipc_tests::settings::parameter_listing_and_writes_check_each_declared_permission",
        "[ui]\ndeveloper_mode=true\n",
        |state| {
            state.identity.permission_lookup = Arc::new(DenySettings);
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
                assert!(
                    entries
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|p| p["key"] == "account.idle_lock_minutes")
                );
            }
            for (key, permission) in [
                ("demo.batch_size", "demo.settings.manage"),
                ("account.idle_lock_minutes", "account.security.manage"),
            ] {
                for command in ["app_setting_set", "app_setting_reset"] {
                    let mut input = json!({"key":key,"rowVersion":null});
                    if command == "app_setting_set" {
                        input["value"] = json!("5");
                    }
                    let error = invoke(window, command, json!({"input":input})).unwrap_err();
                    assert_eq!(error["code"], "app.permission.denied");
                    assert_eq!(error["params"]["permission"], permission);
                }
            }
            let state = window.state::<AppState>();
            assert!(
                tauri::async_runtime::block_on(state.params.entries())
                    .unwrap()
                    .iter()
                    .all(|p| p.row_version.is_none())
            );
        },
    );
}

#[test]
fn network_settings_keep_credentials_local_and_require_active_identity() {
    with_host(
        "ipc_tests::settings::network_settings_keep_credentials_local_and_require_active_identity",
        "",
        |_| {},
        |window, root| {
            assert_eq!(
                invoke(window, "app_network_settings_get", json!({})).unwrap()["mode"]["value"],
                "direct"
            );
            let update = json!({"input":{"mode":"manual","endpoint":"http://127.0.0.1:3128","auth":true,"credentials":{"type":"replace","username":"synthetic-proxy-user-sentinel","password":"synthetic-proxy-password-sentinel"}}});
            let saved = invoke(window, "app_network_settings_update", update.clone()).unwrap();
            assert_eq!(saved["credentialsSet"], true);
            assert_eq!(saved["credentialSource"], "credentialStore");
            assert!(!saved.to_string().contains("sentinel"));
            assert!(
                !invoke(window, "app_network_settings_get", json!({}))
                    .unwrap()
                    .to_string()
                    .contains("sentinel")
            );
            assert!(
                !fs::read_to_string(root.join("config.toml"))
                    .unwrap()
                    .contains("sentinel")
            );
            invoke(
                window,
                "account_auth_enable_login",
                json!({"input":{"password":"network-owner-password"}}),
            )
            .unwrap();
            for (transition, code) in [
                ("account_session_lock", "account.session.locked"),
                ("account_auth_logout", "account.auth.required"),
            ] {
                invoke(window, transition, json!({})).unwrap();
                assert_eq!(
                    invoke(window, "app_network_settings_get", json!({})).unwrap_err()["code"],
                    code
                );
                assert_eq!(
                    invoke(window, "app_network_settings_update", update.clone()).unwrap_err()["code"],
                    code
                );
            }
        },
    );
}

#[test]
fn application_commands_round_trip_settings_parameters_and_modules() {
    with_host(
        "ipc_tests::settings::application_commands_round_trip_settings_parameters_and_modules",
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
        "ipc_tests::settings::module_guard_precedes_identity_and_control_remains_available_when_locked",
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
