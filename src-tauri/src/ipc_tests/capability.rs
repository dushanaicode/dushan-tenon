use dushan_tenon_lib::contract::*;
use serde_json::{Value, json};
use std::{collections::BTreeSet, fs, path::Path};

#[test]
fn main_capability_grants_exactly_application_commands() {
    let capability: Value =
        serde_json::from_str(include_str!("../../capabilities/main.json")).unwrap();
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
fn command_access_and_admission_match_exact_whitelists() {
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
            "account_session_touch",
            "app_file_pick",
            "app_file_ingress_list",
            "app_file_ingress_claim",
            "app_file_ingress_dismiss",
            "app_file_recent_open"
        ])
    );
    assert_eq!(
        COMMAND_ADMISSION
            .iter()
            .filter(|(_, kind)| *kind == CommandAdmission::Maintenance)
            .map(|(name, _)| *name)
            .collect::<Vec<_>>(),
        [
            "app_update_install",
            "app_backup_export",
            "app_backup_restore"
        ]
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
        [
            "app_operation_cancel",
            "app_window_minimize",
            "app_window_toggle_maximize",
            "app_window_start_dragging",
            "app_window_close",
            "app_window_close_decide",
            "app_window_watch",
            "app_window_edit_state",
            "app_window_edit_decide",
        ]
    );
    assert!(
        COMMAND_NAMES
            .iter()
            .all(|name| !name.contains("background") && !name.starts_with("ai_"))
    );
    let names: BTreeSet<_> = COMMAND_NAMES.iter().copied().collect();
    assert_eq!(names.len(), COMMAND_NAMES.len());
    for catalog in [
        COMMAND_ACCESS
            .iter()
            .map(|(name, _)| *name)
            .collect::<Vec<_>>(),
        COMMAND_ADMISSION.iter().map(|(name, _)| *name).collect(),
    ] {
        assert_eq!(catalog.len(), names.len());
        assert_eq!(catalog.into_iter().collect::<BTreeSet<_>>(), names);
    }
    for &(name, access) in COMMAND_ACCESS {
        assert!(matches!(
            access,
            "execute" | "execute_session" | "execute_public" | "execute_control"
        ));
        let admission = COMMAND_ADMISSION
            .iter()
            .find(|(entry, _)| *entry == name)
            .unwrap()
            .1;
        assert_eq!(
            admission == CommandAdmission::Control,
            access == "execute_control",
            "{name}"
        );
    }
    let permissions: BTreeSet<_> = crate::modules::DECLARATIONS
        .iter()
        .flat_map(|d| d.permissions.iter().copied())
        .collect();
    let associations: BTreeSet<_> = COMMAND_PERMISSIONS.iter().copied().collect();
    assert_eq!(associations.len(), COMMAND_PERMISSIONS.len());
    for &(name, permission) in COMMAND_PERMISSIONS {
        assert!(names.contains(name), "{name}");
        assert!(permissions.contains(permission), "{name}: {permission}");
        assert!(COMMAND_ACCESS.contains(&(name, "execute")), "{name}");
    }
}

#[test]
fn every_application_command_rejects_unprivileged_windows() {
    use tauri::Manager;
    super::with_host(
        "ipc_tests::capability::every_application_command_rejects_unprivileged_windows",
        "",
        |_| {},
        |window, _| {
            let other = tauri::WebviewWindowBuilder::new(
                window.app_handle(),
                "unprivileged",
                Default::default(),
            )
            .build()
            .unwrap();
            for command in COMMAND_NAMES {
                // ACL 必须先于参数解析，因此无需构造会触发系统操作的有效业务输入。
                let error = super::invoke(&other, command, json!({})).unwrap_err();
                assert!(
                    error.to_string().contains("not allowed"),
                    "{command}: {error}"
                );
            }
        },
    );
}

#[test]
#[should_panic(expected = "0 passed; 0 failed")]
fn isolated_host_helper_rejects_zero_matching_tests() {
    crate::boot::tests::child("ipc_tests::nonexistent_case");
}
