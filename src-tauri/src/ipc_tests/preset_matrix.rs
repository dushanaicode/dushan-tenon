use super::{invoke, with_host_options};
use crate::{boot, modules, state::AppState};
use dushan_tenon_lib::contract::COMMAND_ACCESS;
use serde_json::{Value, json};
use std::{collections::BTreeSet, fs, path::Path, process::Command};
use tauri::{Manager, WebviewWindow, test::MockRuntime};
use tenon_desktop::config;
use tenon_framework::{ipc, job::SubmitJob, time::Timestamp};

fn workspace() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

fn generated_catalogs() -> Value {
    // Node 原生读取真实 TS 导出，不通过源码字符串匹配重建装配数据。
    let output = Command::new("node").current_dir(workspace()).args(["--input-type=module", "-e", r#"
        import { MODULE_CATALOG } from './src/lib/generated/assembly.ts';
        import { MODULE_IDS, PERMISSION_KEYS } from './src/lib/generated/permissions.ts';
        import { PARAM_KEYS } from './src/lib/generated/param-keys.ts';
        import { JOB_KINDS } from './src/lib/generated/job-kinds.ts';
        console.log(JSON.stringify({ modules: MODULE_CATALOG, ids: MODULE_IDS, permissions: PERMISSION_KEYS, params: PARAM_KEYS, jobs: JOB_KINDS }));
    "#]).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn strings(value: &Value) -> BTreeSet<&str> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect()
}

#[test]
fn real_presets_and_generated_catalogs_match_compiled_declarations() {
    let generated = generated_catalogs();
    let declarations = modules::DECLARATIONS;
    let expected = declarations.iter().map(|d| json!({"id":d.id,"version":d.version,"core":d.core,"dependencies":d.dependencies,"requiredCapabilities":d.required_capabilities.iter().map(|c| c.as_str()).collect::<Vec<_>>()})).collect::<Vec<_>>();
    assert_eq!(generated["modules"], json!(expected));
    let all: BTreeSet<_> = declarations.iter().map(|d| d.id).collect();
    assert_eq!(strings(&generated["ids"]), all);
    assert_eq!(
        strings(&generated["permissions"]),
        declarations
            .iter()
            .flat_map(|d| d.permissions.iter().copied())
            .collect()
    );
    assert_eq!(
        strings(&generated["params"]),
        declarations
            .iter()
            .flat_map(|d| d.params.iter().map(|p| p.key))
            .collect()
    );
    assert_eq!(
        strings(&generated["jobs"]),
        declarations
            .iter()
            .flat_map(|d| d.job_kinds.iter().copied())
            .collect()
    );
    for (preset, enabled, auth) in [
        ("minimal", vec!["account"], "none"),
        ("tool", vec!["account", "notify"], "none"),
        ("full", all.iter().copied().collect(), "login"),
    ] {
        let root = boot::tests::root();
        fs::copy(
            workspace().join(format!("presets/{preset}.toml")),
            root.path().join("config.toml"),
        )
        .unwrap();
        let loaded = config::load(root.path(), [], &[]).unwrap();
        let settings = loaded.modules();
        assert_eq!(
            settings.keys().map(String::as_str).collect::<BTreeSet<_>>(),
            all
        );
        assert_eq!(
            settings
                .iter()
                .filter(|(_, m)| m.enabled)
                .map(|(id, _)| id.as_str())
                .collect::<BTreeSet<_>>(),
            enabled.iter().copied().collect()
        );
        assert_eq!(serde_json::to_value(loaded.auth_mode()).unwrap(), auth);
        assert!(!loaded.settings().developer_mode.value);
        assert!(!loaded.native_settings().check_on_start.value);
        for module in generated["modules"].as_array().unwrap() {
            if enabled.contains(&module["id"].as_str().unwrap()) {
                for dependency in strings(&module["dependencies"]) {
                    assert!(enabled.contains(&dependency), "{preset}: {dependency}");
                }
            }
        }
    }
}

fn check_runtime(window: &WebviewWindow<MockRuntime>, preset: &str, mode: &str) {
    let state = window.state::<AppState>();
    let generated = generated_catalogs();
    let listed = state.modules.list(&[]);
    let enabled: BTreeSet<_> = listed
        .iter()
        .filter(|m| m.enabled)
        .map(|m| m.id.as_str())
        .collect();
    let expected: BTreeSet<_> = match preset {
        "minimal" => BTreeSet::from(["account"]),
        "tool" => BTreeSet::from(["account", "notify"]),
        "full" => strings(&generated["ids"]),
        _ => panic!("unknown preset: {preset}"),
    };
    assert_eq!(enabled, expected);
    assert_eq!(
        state
            .modules
            .permissions()
            .into_iter()
            .collect::<BTreeSet<_>>(),
        strings(&generated["permissions"])
    );
    assert_eq!(
        state
            .modules
            .params()
            .iter()
            .map(|p| p.key)
            .collect::<BTreeSet<_>>(),
        strings(&generated["params"])
    );
    let migrations = modules::migrations();
    assert_eq!(
        state
            .modules
            .migrations()
            .iter()
            .map(|m| (m.info.module, m.info.version))
            .collect::<Vec<_>>(),
        migrations
            .iter()
            .map(|m| (m.info.module, m.info.version))
            .collect::<Vec<_>>()
    );
    // 运行中的任务队列只接受启用模块的任务种类；任务排在一小时后，测试期间不会执行。
    for kind in strings(&generated["jobs"]) {
        let submitted = tauri::async_runtime::block_on(state.jobs.submit(
            &state.db,
            SubmitJob {
                kind: kind.into(),
                payload: json!({}),
                priority: 0,
                run_after: Some(
                    Timestamp::from_millis(Timestamp::now().as_millis() + 3_600_000).unwrap(),
                ),
                submitted_by: None,
            },
        ));
        assert_eq!(
            submitted.is_ok(),
            enabled.contains(kind.split_once('.').unwrap().0),
            "{kind}"
        );
    }
    assert_eq!(
        invoke(window, "account_auth_status", json!({})).unwrap()["state"],
        if mode == "login" {
            "initRequired"
        } else {
            "active"
        }
    );
    // 停用模块的每一个真实清单入口必须先拒绝，业务闭包不可到达。
    for &(command, access) in COMMAND_ACCESS {
        let module = command.split_once('_').unwrap().0;
        if !listed.iter().any(|m| m.id == module && !m.enabled) {
            continue;
        }
        let error = tauri::async_runtime::block_on(async {
            let result: Result<(), _> = match access {
                "execute" => {
                    ipc::execute(state.inner(), command, |_| async {
                        panic!("disabled command reached service: {command}")
                    })
                    .await
                }
                "execute_session" => {
                    ipc::execute_session(state.inner(), command, |_| async {
                        panic!("disabled command reached session: {command}")
                    })
                    .await
                }
                "execute_public" => {
                    ipc::execute_public(state.inner(), command, |_| async {
                        panic!("disabled command reached public: {command}")
                    })
                    .await
                }
                _ => panic!("unexpected module access: {access}"),
            };
            result
        })
        .unwrap_err();
        assert_eq!(error.code, "app.module.disabled", "{command}");
    }
    if mode == "login" {
        assert_eq!(
            invoke(window, "account_user_me", json!({})).unwrap_err()["code"],
            "account.auth.init_required"
        );
        assert_eq!(
            invoke(
                window,
                "app_settings_update",
                json!({"input":{"developerMode":true}})
            )
            .unwrap_err()["code"],
            "account.auth.init_required"
        );
        assert_eq!(
            invoke(window, "notify_unread_count", json!({})).unwrap_err()["code"],
            if enabled.contains("notify") {
                "account.auth.init_required"
            } else {
                "app.module.disabled"
            }
        );
        invoke(
            window,
            "account_auth_initialize",
            json!({"input":{"password":"preset-owner-password"}}),
        )
        .unwrap();
    }
    assert!(invoke(window, "account_user_me", json!({})).is_ok());
    assert!(invoke(window, "app_native_settings_get", json!({})).is_ok());
    for developer in [false, true, false] {
        invoke(
            window,
            "app_settings_update",
            json!({"input":{"developerMode":developer}}),
        )
        .unwrap();
        let visible = invoke(
            window,
            "app_setting_list",
            json!({"input":{"includeDisabled":false}}),
        )
        .unwrap();
        assert!(
            visible
                .as_array()
                .unwrap()
                .iter()
                .all(|p| enabled.contains(p["key"].as_str().unwrap().split_once('.').unwrap().0))
        );
        let inspected = invoke(
            window,
            "app_setting_list",
            json!({"input":{"includeDisabled":true}}),
        );
        if developer {
            assert_eq!(
                inspected
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| p["key"].as_str().unwrap())
                    .collect::<BTreeSet<_>>(),
                strings(&generated["params"])
            );
        } else {
            assert_eq!(inspected.unwrap_err()["code"], "app.data.not_found");
        }
    }
}

fn matrix(name: &str, preset: &str, mode: &str) {
    let seed = fs::read_to_string(workspace().join(format!("presets/{preset}.toml"))).unwrap();
    with_host_options(
        name,
        &seed,
        boot::Options {
            overrides: vec![format!("auth.mode={mode}")],
            ..Default::default()
        },
        boot::tests::ports(),
        |_| {},
        |window, _| check_runtime(window, preset, mode),
    );
}

#[test]
fn minimal_without_login() {
    matrix(
        "ipc_tests::preset_matrix::minimal_without_login",
        "minimal",
        "none",
    );
}
#[test]
fn minimal_with_login() {
    matrix(
        "ipc_tests::preset_matrix::minimal_with_login",
        "minimal",
        "login",
    );
}
#[test]
fn tool_without_login() {
    matrix(
        "ipc_tests::preset_matrix::tool_without_login",
        "tool",
        "none",
    );
}
#[test]
fn tool_with_login() {
    matrix("ipc_tests::preset_matrix::tool_with_login", "tool", "login");
}
#[test]
fn full_without_login() {
    matrix(
        "ipc_tests::preset_matrix::full_without_login",
        "full",
        "none",
    );
}
#[test]
fn full_with_login() {
    matrix("ipc_tests::preset_matrix::full_with_login", "full", "login");
}
