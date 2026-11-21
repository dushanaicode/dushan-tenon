//! 备份白名单、严格 JSON 边界与单次目标读取的类型化合并行为。

use super::*;

#[test]
fn projection_uses_file_values_not_overrides_or_comments() {
    let root = state_root();
    fs::write(root.path().join("config.toml"), "# secret-comment-sentinel\n[ui]\nlanguage='en-US'\n[network]\nproxy_endpoint='https://private-device.invalid'\n").unwrap();
    let effective = read(
        root.path(),
        &[("TENON__UI__LANGUAGE", "zh-CN")],
        &["ui.theme=dark"],
    )
    .unwrap();
    assert_eq!(effective.language(), Language::ZhCn);
    let projection = project_backup(root.path()).unwrap();
    let json = serde_json::to_value(&projection).unwrap();
    assert_eq!(json["ui"]["language"], "en-US");
    assert_eq!(json["ui"]["theme"], "system");
    assert_eq!(
        json.as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>(),
        [
            "ui", "auth", "modules", "jobs", "logging", "notify", "database"
        ]
        .into_iter()
        .collect()
    );
    let encoded = serde_json::to_string(&projection).unwrap();
    assert!(!encoded.contains("sentinel"));
    assert!(!encoded.contains("private-device"));
    let decoded: BackupConfig = serde_json::from_str(&encoded).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), json);
    fs::write(root.path().join("config.toml"), "[unknown]\nsecret='x'\n").unwrap();
    assert!(project_backup(root.path()).is_err());
}

#[test]
fn merge_preserves_target_device_fields_and_developer_mode() {
    let source = state_root();
    let target = state_root();
    fs::write(source.path().join("config.toml"), "[ui]\ntheme='dark'\nlanguage='en-US'\ndeveloper_mode=false\n[auth]\nmode='login'\n[notify]\ndesktop=false\n[jobs]\nmax_concurrency=9\nlease_seconds=100\n[logging]\nlevel='debug'\nretention_days=4\n[modules.sample]\nenabled=false\n").unwrap();
    let text = "# target device\n[ui]\ntheme='light'\nlanguage='zh-CN'\ndeveloper_mode=true # local\n[window]\nrestore_state=false\ntitlebar='hidden'\nclose_action='tray'\n[tray]\nenabled=true\n[autostart]\nenabled=true\n[shortcuts]\nshow_main='Ctrl+Shift+Y'\n[updater]\ncheck_on_start=true\n[network]\nproxy_mode='manual'\nproxy_endpoint='https://target.invalid'\nproxy_auth=true\n[database]\nbackup_keep=11\n[cache]\nprovider='redis'\nhost='localhost'\nport=6379\nkey_prefix='device'\n[auth]\nmode='none'\nsession_max_hours=48\ncaptcha_after_failures=4\nlock_after_failures=20\nlock_minutes=30\n[modules.obsolete]\nenabled=true\n";
    let path = target.path().join("config.toml");
    fs::write(&path, text).unwrap();
    let projection = project_backup(source.path()).unwrap();
    let merged = merge_backup(target.path(), &projection).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    assert_eq!(fs::read_dir(target.path()).unwrap().count(), 1);
    assert!(merged.starts_with("# target device"));
    assert!(merged.contains("developer_mode=true # local"));
    let before: Table = text.parse().unwrap();
    let after: Table = merged.parse().unwrap();
    for section in [
        "window",
        "tray",
        "autostart",
        "shortcuts",
        "updater",
        "network",
        "database",
        "cache",
    ] {
        assert_eq!(after[section], before[section], "{section}");
    }
    let loaded = super::super::loader::load_text(target.path(), Some(&merged), [], &[]).unwrap();
    assert_eq!(loaded.settings().theme.value, Theme::Dark);
    assert_eq!(loaded.language(), Language::EnUs);
    assert!(loaded.settings().developer_mode.value);
    assert_eq!(loaded.auth_mode(), AuthMode::Login);
    let auth = loaded.auth();
    assert_eq!(
        (
            auth.session_max_hours,
            auth.captcha_after_failures,
            auth.lock_after_failures,
            auth.lock_minutes
        ),
        (48, 4, 20, 30)
    );
    assert!(!loaded.notify().desktop);
    assert_eq!(loaded.jobs().max_concurrency(), 9);
    assert_eq!(loaded.jobs().lease_seconds(), 100);
    assert_eq!(loaded.logging().level, LogLevel::Debug);
    assert_eq!(loaded.logging().retention_days.get(), 4);
    assert_eq!(
        loaded
            .modules()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["sample"]
    );
    assert!(!loaded.modules()["sample"].enabled);
}

#[test]
fn merge_into_missing_target_keeps_device_defaults() {
    let source = state_root();
    let target = state_root();
    fs::write(
        source.path().join("config.toml"),
        "[ui]\ndeveloper_mode=true\ntheme='light'\n",
    )
    .unwrap();
    let projection = project_backup(source.path()).unwrap();
    let merged = merge_backup(target.path(), &projection).unwrap();
    let config = super::super::loader::load_text(target.path(), Some(&merged), [], &[]).unwrap();
    assert!(!config.settings().developer_mode.value);
    assert_eq!(config.settings().theme.value, Theme::Light);
    assert_eq!(config.database().backup_keep.get(), 5);
    assert!(!target.path().join("config.toml").exists());
}

#[test]
fn merge_preserves_inline_device_fields_and_relative_ca_path() {
    let source = state_root();
    let target = state_root();
    fs::write(target.path().join("ca.pem"), "certificate fixture").unwrap();
    let text = "ui = { theme='light', developer_mode=false } # local\nauth = { mode='none', session_max_hours=48 }\n[database]\nkind='postgres'\nhost='localhost'\nport=5432\nname='target'\nusername='owner'\ntls_ca_file='ca.pem'\n";
    fs::write(target.path().join("config.toml"), text).unwrap();
    let mut projection = project_backup(source.path()).unwrap();
    projection.ui.developer_mode = true;
    projection.ui.theme = Theme::Dark;
    let merged = merge_backup(target.path(), &projection).unwrap();
    assert_eq!(
        merged.parse::<Table>().unwrap()["database"],
        text.parse::<Table>().unwrap()["database"]
    );
    let config = super::super::loader::load_text(target.path(), Some(&merged), [], &[]).unwrap();
    assert!(!config.settings().developer_mode.value);
    assert_eq!(config.settings().theme.value, Theme::Dark);
    assert_eq!(config.database().kind(), DatabaseKind::Postgres);
    assert_eq!(
        fs::read_to_string(target.path().join("config.toml")).unwrap(),
        text
    );
}

#[test]
fn backup_json_rejects_extra_fields_legacy_keys_and_remote_database() {
    let root = state_root();
    let baseline = serde_json::to_value(project_backup(root.path()).unwrap()).unwrap();
    for (section, key, value) in [
        ("auth", "session_max_hours", serde_json::json!(24)),
        ("database", "host", serde_json::json!("localhost")),
        ("database", "kind", serde_json::json!("postgres")),
        ("ui", "user_adjustable", serde_json::json!([])),
        ("ui", "background", serde_json::json!("solid")),
        ("notify", "unknown", serde_json::json!(true)),
        ("jobs", "unknown", serde_json::json!(1)),
    ] {
        let mut input = baseline.clone();
        input[section][key] = value;
        assert!(
            serde_json::from_value::<BackupConfig>(input).is_err(),
            "{section}.{key}"
        );
    }
    for key in ["notifications", "network", "cache"] {
        let mut input = baseline.clone();
        input[key] = serde_json::json!({});
        assert!(
            serde_json::from_value::<BackupConfig>(input).is_err(),
            "{key}"
        );
    }
    for key in baseline.as_object().unwrap().keys() {
        let mut input = baseline.clone();
        input.as_object_mut().unwrap().remove(key);
        assert!(
            serde_json::from_value::<BackupConfig>(input).is_err(),
            "missing {key}"
        );
    }
}

#[test]
fn merge_validates_job_ranges_auth_policy_and_target_configuration() {
    let source = state_root();
    let target = state_root();
    let mut projection = project_backup(source.path()).unwrap();
    for (concurrency, lease, path) in [
        (0, 30, "jobs.max_concurrency"),
        (4, 9, "jobs.lease_seconds"),
    ] {
        projection.jobs = BackupJobs {
            max_concurrency: concurrency,
            lease_seconds: lease,
        };
        let error = merge_backup(target.path(), &projection).unwrap_err();
        assert!(matches!(error, ConfigError::Field { path: actual, .. } if actual == path));
    }
    projection.jobs = BackupJobs {
        max_concurrency: 4,
        lease_seconds: 30,
    };
    projection.auth.mode = AuthMode::Login;
    fs::write(
        target.path().join("config.toml"),
        "[auth]\nmode='none'\nsession_max_hours=0\n",
    )
    .unwrap();
    assert!(
        matches!(merge_backup(target.path(), &projection).unwrap_err(), ConfigError::Field { path, .. } if path == "auth.session_max_hours")
    );
    fs::write(target.path().join("config.toml"), "[unknown]\nvalue=true\n").unwrap();
    assert!(
        matches!(merge_backup(target.path(), &projection).unwrap_err(), ConfigError::Field { path, .. } if path == "unknown")
    );
}
