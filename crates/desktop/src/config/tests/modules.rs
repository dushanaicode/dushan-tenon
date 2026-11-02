//! modules 行为测试。

use super::*;

#[test]
fn auth_mode_update_validates_policy_sources_and_commits_atomically() {
    let root = state_root();
    let path = root.path().join("config.toml");
    let invalid = "# policy\n[auth]\nmode='none'\nsession_max_hours=0\n";
    fs::write(&path, invalid).unwrap();
    let mut config = read(root.path(), &[], &[]).unwrap();
    let error = config
        .update_auth_mode(root.path(), AuthMode::Login)
        .unwrap_err();
    assert_eq!(error.params()["path"], "auth.session_max_hours");
    assert_eq!(config.auth_mode(), AuthMode::None);
    assert_eq!(fs::read_to_string(&path).unwrap(), invalid);
    fs::write(&path, invalid.replace("hours=0", "hours=12")).unwrap();
    let mut config = read(root.path(), &[], &[]).unwrap();
    for mode in [AuthMode::Login, AuthMode::None] {
        config.update_auth_mode(root.path(), mode).unwrap();
        assert_eq!(read(root.path(), &[], &[]).unwrap().auth_mode(), mode);
        assert_eq!(config.source("auth.mode"), ConfigSource::File);
        assert_eq!(config.auth().session_max_hours, 12);
    }
    for (environment, overrides) in [
        (vec![("TENON__AUTH__MODE", "none")], vec![]),
        (vec![], vec!["auth.mode=none"]),
    ] {
        let mut locked = read(root.path(), &environment, &overrides).unwrap();
        for mode in [AuthMode::None, AuthMode::Login] {
            assert_eq!(
                locked
                    .update_auth_mode(root.path(), mode)
                    .unwrap_err()
                    .code(),
                SETTINGS_OVERRIDDEN
            );
        }
    }
    let before = fs::read(&path).unwrap();
    assert!(
        config
            .update_auth_mode(&root.path().join("missing"), AuthMode::Login)
            .is_err()
    );
    assert_eq!(config.auth_mode(), AuthMode::None);
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn desktop_notification_setting_defaults_persists_and_respects_overrides() {
    let root = state_root();
    let mut config = read(root.path(), &[], &[]).unwrap();
    assert!(config.notify().desktop);
    let settings = config
        .update_settings(
            root.path(),
            &AppSettingsUpdate {
                desktop_notifications: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(!settings.desktop_notifications.value);
    assert!(
        serde_json::to_value(&settings)
            .unwrap()
            .get("desktopNotifications")
            .is_some()
    );
    assert_eq!(settings.desktop_notifications.source, ConfigSource::File);
    assert!(!read(root.path(), &[], &[]).unwrap().notify().desktop);
    for (env, cli, source) in [
        (
            vec![("TENON__NOTIFY__DESKTOP", "true")],
            vec![],
            ConfigSource::Environment,
        ),
        (
            vec![],
            vec!["notify.desktop=true"],
            ConfigSource::CommandLine,
        ),
    ] {
        let mut loaded = read(root.path(), &env, &cli).unwrap();
        assert!(loaded.notify().desktop);
        assert_eq!(loaded.settings().desktop_notifications.source, source);
        assert_eq!(
            loaded
                .update_settings(
                    root.path(),
                    &AppSettingsUpdate {
                        desktop_notifications: Some(false),
                        ..Default::default()
                    }
                )
                .unwrap_err()
                .code(),
            SETTINGS_OVERRIDDEN
        );
    }
    assert!(read(root.path(), &[], &["notify.desktop=1"]).is_err());
}

#[test]
fn notify_configuration_rejects_the_removed_section_and_overrides() {
    let root = state_root();
    let old_section = "notifications";
    fs::write(
        root.path().join("config.toml"),
        format!("[{old_section}]\ndesktop = false\n"),
    )
    .unwrap();
    assert!(read(root.path(), &[], &[]).is_err());
    fs::write(root.path().join("config.toml"), "").unwrap();
    let old_key = [old_section, "desktop"].join(".");
    assert!(read(root.path(), &[], &[&format!("{old_key}=false")]).is_err());
    let old_env = ["TENON", "NOTIFICATIONS", "DESKTOP"].join("__");
    assert!(read(root.path(), &[(&old_env, "false")], &[]).is_err());
    assert!(read(root.path(), &[], &[]).unwrap().notify().desktop);
}

#[test]
fn jobs_defaults_and_bounds_are_validated() {
    let root = state_root();
    let defaults = load(root.path(), [], &[]).unwrap().jobs();
    assert_eq!(defaults.max_concurrency(), 4);
    assert_eq!(defaults.lease_seconds(), 30);
    for (key, value) in [
        ("jobs.max_concurrency", 0),
        ("jobs.max_concurrency", 65),
        ("jobs.lease_seconds", 9),
        ("jobs.lease_seconds", 601),
    ] {
        assert!(
            matches!(load(root.path(),[],&[format!("{key}={value}")]).unwrap_err(),ConfigError::Field{path,..} if path==key)
        );
    }
    for overrides in [
        ["jobs.max_concurrency=1", "jobs.lease_seconds=10"],
        ["jobs.max_concurrency=64", "jobs.lease_seconds=600"],
    ] {
        load(root.path(), [], &overrides.map(str::to_owned)).unwrap();
    }
}

#[test]
fn removed_parameter_configuration_keys_are_rejected() {
    let root = state_root();
    let check = |error| {
        assert!(
            matches!(error, ConfigError::Field { path, .. } if path == "auth.idle_lock_minutes")
        )
    };
    check(read(root.path(), &[], &["auth.idle_lock_minutes=15"]).unwrap_err());
    check(
        read(
            root.path(),
            &[("TENON__AUTH__IDLE_LOCK_MINUTES", "15")],
            &[],
        )
        .unwrap_err(),
    );
    fs::write(
        root.path().join("config.toml"),
        "[auth]\nidle_lock_minutes = 15\n",
    )
    .unwrap();
    check(read(root.path(), &[], &[]).unwrap_err());
}

#[test]
fn auth_and_module_configuration_defaults_overrides_and_field_paths() {
    let root = state_root();
    let default = read(root.path(), &[], &[]).unwrap();
    assert_eq!(default.auth_mode(), AuthMode::None);
    assert!(default.modules().is_empty());
    fs::write(
        root.path().join("config.toml"),
        "[auth]\nmode = 'none'\n[modules.demo]\nenabled = false\n[modules.system]\n",
    )
    .unwrap();
    let file = read(root.path(), &[], &[]).unwrap();
    assert!(!file.modules()["demo"].enabled);
    assert!(file.modules()["system"].enabled);
    let env = read(
        root.path(),
        &[("TENON__MODULES__DEMO__ENABLED", "true")],
        &[],
    )
    .unwrap();
    assert!(env.modules()["demo"].enabled);
    let cli = read(
        root.path(),
        &[("TENON__MODULES__DEMO__ENABLED", "true")],
        &["modules.demo.enabled=false"],
    )
    .unwrap();
    assert!(!cli.modules()["demo"].enabled);
    for (value, expected) in [
        ("auth.mode=invalid", "auth.mode"),
        ("modules.demo.enabled=maybe", "modules.demo.enabled"),
        ("modules.demo.unknown=true", "modules.demo.unknown"),
    ] {
        let error = read(root.path(), &[], &[value]).unwrap_err();
        assert!(
            matches!(error, ConfigError::Field { ref path, .. } if path == expected),
            "{error}"
        );
    }
}

#[test]
fn login_protection_limits_defaults_and_field_paths() {
    let root = state_root();
    let auth = read(root.path(), &[], &[]).unwrap().auth();
    assert_eq!(
        (
            auth.captcha_after_failures,
            auth.lock_after_failures,
            auth.lock_minutes
        ),
        (3, 10, 15)
    );
    for mode in ["auth.mode=none", "auth.mode=login"] {
        for (field, values) in [
            ("captcha_after_failures", vec![-1, 0, 101]),
            ("lock_after_failures", vec![-1, 0, 3, 1001]),
            ("lock_minutes", vec![-1, 0, 1441]),
        ] {
            for value in values {
                let error =
                    read(root.path(), &[], &[mode, &format!("auth.{field}={value}")]).unwrap_err();
                assert!(
                    matches!(error, ConfigError::Field { path, .. } if path == format!("auth.{field}"))
                );
            }
        }
    }
    for overrides in [
        [
            "auth.captcha_after_failures=1",
            "auth.lock_after_failures=2",
            "auth.lock_minutes=1",
        ],
        [
            "auth.captcha_after_failures=100",
            "auth.lock_after_failures=1000",
            "auth.lock_minutes=1440",
        ],
    ] {
        read(root.path(), &[], &overrides).unwrap();
    }
}

#[test]
fn login_time_limits_validate_paths_only_when_enabled() {
    let root = state_root();
    let defaults = read(root.path(), &[], &["auth.mode=login"]).unwrap();
    assert_eq!(defaults.auth().session_max_hours, 24);
    for (field, max) in [("session_max_hours", 720)] {
        for value in [0, -1, max + 1] {
            let entry = format!("auth.{field}={value}");
            let error = read(root.path(), &[], &["auth.mode=login", &entry]).unwrap_err();
            assert!(
                matches!(error, ConfigError::Field { path, .. } if path == format!("auth.{field}"))
            );
            read(root.path(), &[], &["auth.mode=none", &entry]).unwrap();
        }
        for value in [1, max] {
            read(
                root.path(),
                &[],
                &["auth.mode=login", &format!("auth.{field}={value}")],
            )
            .unwrap();
        }
    }
}
