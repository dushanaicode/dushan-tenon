//! native 行为测试。

use super::*;

#[test]
fn single_native_groups_reject_overrides_and_keep_saved_state() {
    let root = state_root();
    for (key, value, input) in [
        (
            "autostart.enabled",
            "true",
            NativeSettingsChange::Autostart(AutostartSettingsChange { enabled: true }),
        ),
        (
            "shortcuts.show_main",
            "Ctrl+Alt+T",
            NativeSettingsChange::Shortcut(ShortcutSettingsChange {
                binding: "Ctrl+Alt+T".into(),
            }),
        ),
        (
            "updater.check_on_start",
            "true",
            NativeSettingsChange::Updater(UpdaterSettingsChange {
                check_on_start: true,
            }),
        ),
    ] {
        let env = format!("TENON__{}", key.to_ascii_uppercase().replace('.', "__"));
        let cli = format!("{key}={value}");
        for (environment, overrides) in [
            (vec![(env.as_str(), value)], vec![]),
            (vec![], vec![cli.as_str()]),
        ] {
            let mut config = read(root.path(), &environment, &overrides).unwrap();
            let before = serde_json::to_value(config.native_settings()).unwrap();
            let error = config
                .update_native_settings(root.path(), &input)
                .unwrap_err();
            assert_eq!(error.code(), SETTINGS_OVERRIDDEN);
            assert_eq!(error.params()["key"], key);
            assert_eq!(
                serde_json::to_value(config.native_settings()).unwrap(),
                before
            );
            assert!(!root.path().join("config.toml").exists());
        }
    }
    let mut config = read(root.path(), &[], &[]).unwrap();
    let input = NativeSettingsChange::Updater(UpdaterSettingsChange {
        check_on_start: true,
    });
    config.update_native_settings(root.path(), &input).unwrap();
    assert!(
        read(root.path(), &[], &[])
            .unwrap()
            .native_settings()
            .check_on_start
            .value
    );
}

#[test]
fn tray_pair_is_strict_atomic_and_device_only() {
    let root = state_root();
    let mut config = read(root.path(), &[], &[]).unwrap();
    let baseline = serde_json::to_value(config.settings()).unwrap();
    assert!(!config.native_settings().tray_enabled.value);
    assert_eq!(
        config.native_settings().close_action.value,
        CloseAction::Exit
    );
    assert_eq!(config.native_settings().titlebar.value, Titlebar::Native);
    assert_eq!(
        config.native_settings().close_action.source,
        ConfigSource::Default
    );
    assert_eq!(
        config.native_settings().titlebar.source,
        ConfigSource::Default
    );
    for (preset, titlebar) in [
        (
            include_str!("../../../../../presets/minimal.toml"),
            "native",
        ),
        (include_str!("../../../../../presets/tool.toml"), "native"),
        (include_str!("../../../../../presets/full.toml"), "hidden"),
    ] {
        let table = preset.parse::<toml::Table>().unwrap();
        assert_eq!(table["tray"]["enabled"].as_bool(), Some(false));
        assert_eq!(table["window"]["close_action"].as_str(), Some("exit"));
        assert_eq!(table["window"]["titlebar"].as_str(), Some(titlebar));
        assert_eq!(table["tray"].as_table().unwrap().len(), 1);
    }
    for value in [
        "window.close_action=true",
        "window.close_action=tray",
        "window.close_action=unknown",
        "window.titlebar=unknown",
        "window.titlebar=true",
        "tray.enabled=1",
        "tray.hidden=true",
    ] {
        assert!(read(root.path(), &[], &[value]).is_err());
    }
    for input in [
        r#"{"type":"tray","enabled":true,"closeAction":"tray","window":"other"}"#,
        r#"{"type":"tray","enabled":"true","closeAction":"exit"}"#,
        r#"{"type":"tray","enabled":true,"closeAction":"unknown"}"#,
        r#"{"type":"tray","enabled":true,"closeAction":true}"#,
        r#"{"type":"window","restoreState":true,"titlebar":"hidden"}"#,
        r#"{"type":"tray","enabled":true}"#,
    ] {
        assert!(serde_json::from_str::<NativeSettingsChange>(input).is_err());
    }
    let change = |enabled, close_action| {
        NativeSettingsChange::Tray(TraySettingsChange {
            enabled,
            close_action,
        })
    };
    assert_eq!(
        config
            .update_native_settings(root.path(), &change(false, CloseAction::Tray))
            .unwrap_err()
            .code(),
        tenon_framework::error::INPUT_INVALID
    );
    config
        .update_native_settings(root.path(), &change(true, CloseAction::Tray))
        .unwrap();
    let enabled = read(root.path(), &[], &[]).unwrap().native_settings();
    assert!(enabled.tray_enabled.value);
    assert_eq!(enabled.close_action.value, CloseAction::Tray);
    assert_eq!(enabled.tray_enabled.source, ConfigSource::File);
    assert_eq!(enabled.close_action.source, ConfigSource::File);
    let before = fs::read(root.path().join("config.toml")).unwrap();
    for (env, cli) in [
        (vec![("TENON__TRAY__ENABLED", "true")], vec![]),
        (vec![("TENON__WINDOW__CLOSE_ACTION", "tray")], vec![]),
        (vec![], vec!["tray.enabled=true"]),
        (vec![], vec!["window.close_action=tray"]),
    ] {
        let mut overridden = read(root.path(), &env, &cli).unwrap();
        assert_eq!(
            overridden
                .update_native_settings(root.path(), &change(false, CloseAction::Exit))
                .unwrap_err()
                .code(),
            SETTINGS_OVERRIDDEN
        );
        assert_eq!(fs::read(root.path().join("config.toml")).unwrap(), before);
    }
    assert!(
        config
            .update_native_settings(
                &root.path().join("missing"),
                &change(false, CloseAction::Exit)
            )
            .is_err()
    );
    assert_eq!(
        config.native_settings().close_action.value,
        CloseAction::Tray
    );
    config
        .update_native_settings(root.path(), &change(false, CloseAction::Exit))
        .unwrap();
    let disabled = read(root.path(), &[], &[]).unwrap().native_settings();
    assert!(!disabled.tray_enabled.value);
    assert_eq!(disabled.close_action.value, CloseAction::Exit);
    assert_eq!(serde_json::to_value(config.settings()).unwrap(), baseline);
    assert!(
        serde_json::to_value(project_backup(root.path()).unwrap())
            .unwrap()
            .get("tray")
            .is_none()
    );
}

#[test]
fn window_titlebar_and_close_action_parse_validate_and_track_sources() {
    let root = state_root();
    let invalid = read(root.path(), &[], &["window.close_action=tray"]).unwrap_err();
    let ConfigError::Field { path, reason } = invalid else {
        panic!("field validation required")
    };
    assert_eq!(path, "window.close_action");
    assert_eq!(reason, "隐藏到托盘必须同时启用托盘");
    fs::write(
        root.path().join("config.toml"),
        "[window]\ntitlebar='hidden'\nclose_action='ask'\n",
    )
    .unwrap();
    let file = read(root.path(), &[], &[]).unwrap().native_settings();
    assert_eq!(file.titlebar.value, Titlebar::Hidden);
    assert_eq!(file.close_action.value, CloseAction::Ask);
    assert_eq!(file.titlebar.source, ConfigSource::File);
    assert_eq!(file.close_action.source, ConfigSource::File);
    assert!(!file.tray_enabled.value);
    let env = [
        ("TENON__WINDOW__TITLEBAR", "native"),
        ("TENON__WINDOW__CLOSE_ACTION", "exit"),
    ];
    let environment = read(root.path(), &env, &[]).unwrap().native_settings();
    assert_eq!(environment.titlebar.value, Titlebar::Native);
    assert_eq!(environment.close_action.value, CloseAction::Exit);
    assert_eq!(environment.titlebar.source, ConfigSource::Environment);
    assert_eq!(environment.close_action.source, ConfigSource::Environment);
    let cli = read(
        root.path(),
        &env,
        &[
            "window.titlebar=hidden",
            "window.close_action=tray",
            "tray.enabled=true",
        ],
    )
    .unwrap()
    .native_settings();
    assert_eq!(cli.titlebar.value, Titlebar::Hidden);
    assert_eq!(cli.close_action.value, CloseAction::Tray);
    assert_eq!(cli.titlebar.source, ConfigSource::CommandLine);
    assert_eq!(cli.close_action.source, ConfigSource::CommandLine);
    let mut config = read(root.path(), &[], &[]).unwrap();
    let before = fs::read(root.path().join("config.toml")).unwrap();
    assert!(
        config
            .update_native_settings(
                root.path(),
                &NativeSettingsChange::Tray(TraySettingsChange {
                    enabled: false,
                    close_action: CloseAction::Tray
                })
            )
            .is_err()
    );
    assert_eq!(fs::read(root.path().join("config.toml")).unwrap(), before);
    assert_eq!(
        config.native_settings().close_action.value,
        CloseAction::Ask
    );
}

#[test]
fn public_settings_expose_titlebar_sources_and_accept_updates() {
    let root = state_root();
    let defaults = read(root.path(), &[], &[]).unwrap().settings();
    assert_eq!(defaults.titlebar.value, Titlebar::Native);
    assert_eq!(defaults.titlebar.source, ConfigSource::Default);
    fs::write(
        root.path().join("config.toml"),
        "[window]\ntitlebar='hidden'\n",
    )
    .unwrap();
    let env = [("TENON__WINDOW__TITLEBAR", "native")];
    for (environment, cli, value, source) in [
        (&[][..], &[][..], Titlebar::Hidden, ConfigSource::File),
        (
            &env[..],
            &[][..],
            Titlebar::Native,
            ConfigSource::Environment,
        ),
        (
            &env[..],
            &["window.titlebar=hidden"][..],
            Titlebar::Hidden,
            ConfigSource::CommandLine,
        ),
    ] {
        let settings = read(root.path(), environment, cli).unwrap().settings();
        assert_eq!(settings.titlebar.value, value);
        assert_eq!(settings.titlebar.source, source);
        assert!(
            serde_json::to_value(settings)
                .unwrap()
                .get("titlebar")
                .is_some()
        );
    }
    let update: AppSettingsUpdate = serde_json::from_str(r#"{"titlebar":"hidden"}"#).unwrap();
    assert_eq!(update.titlebar, Some(Titlebar::Hidden));
    assert!(serde_json::from_str::<AppSettingsUpdate>(r#"{"titlebar":"unknown"}"#).is_err());
}

#[test]
fn titlebar_settings_update_persists_and_tracks_file_source() {
    let root = state_root();
    let path = root.path().join("config.toml");
    let original = "# titlebar fixture\n[ui]\n";
    fs::write(&path, original).unwrap();
    let mut config = read(root.path(), &[], &[]).unwrap();
    let unchanged = serde_json::from_str(r#"{"titlebar":"native"}"#).unwrap();
    let settings = config.update_settings(root.path(), &unchanged).unwrap();
    assert_eq!(settings.titlebar.source, ConfigSource::Default);
    assert_eq!(fs::read_to_string(&path).unwrap(), original);

    for titlebar in [Titlebar::Hidden, Titlebar::Native] {
        let input = serde_json::from_value(serde_json::json!({"titlebar": titlebar})).unwrap();
        let settings = config.update_settings(root.path(), &input).unwrap();
        assert_eq!(settings.titlebar.value, titlebar);
        assert_eq!(settings.titlebar.source, ConfigSource::File);
        let reopened = read(root.path(), &[], &[]).unwrap().settings();
        assert_eq!(reopened.titlebar.value, titlebar);
        assert_eq!(reopened.titlebar.source, ConfigSource::File);
        let saved = fs::read_to_string(&path).unwrap();
        assert!(saved.starts_with(original));
        let table: Table = saved.parse().unwrap();
        assert_eq!(
            table["window"]["titlebar"],
            Value::try_from(titlebar).unwrap()
        );
        assert!(table["ui"].get("titlebar").is_none());
    }
}

#[test]
fn titlebar_settings_update_rejects_overrides_before_writing() {
    let root = state_root();
    let path = root.path().join("config.toml");
    let original = "[window]\ntitlebar='hidden'\n[ui]\n";
    fs::write(&path, original).unwrap();
    for (env, cli, source) in [
        (
            vec![("TENON__WINDOW__TITLEBAR", "native")],
            vec![],
            ConfigSource::Environment,
        ),
        (
            vec![],
            vec!["window.titlebar=native"],
            ConfigSource::CommandLine,
        ),
    ] {
        let mut config = read(root.path(), &env, &cli).unwrap();
        for titlebar in ["hidden", "native"] {
            let input = serde_json::from_value(serde_json::json!({
                "titlebar": titlebar, "theme": "light"
            }))
            .unwrap();
            let error = config.update_settings(root.path(), &input).unwrap_err();
            assert_eq!(error.code(), SETTINGS_OVERRIDDEN);
            assert_eq!(error.params()["key"], "window.titlebar");
            assert_eq!(config.settings().titlebar.value, Titlebar::Native);
            assert_eq!(config.settings().titlebar.source, source);
            assert_eq!(config.settings().theme.value, Theme::System);
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
        }
    }
}

#[test]
fn native_defaults_sources_and_strict_inputs() {
    let root = state_root();
    let mut config = read(root.path(), &[], &[]).unwrap();
    assert!(!config.native_settings().autostart.value);
    assert!(config.native_settings().show_main.value.is_empty());
    let old_settings = serde_json::to_value(config.settings()).unwrap();
    for input in [
        NativeSettingsChange::Autostart(AutostartSettingsChange { enabled: true }),
        NativeSettingsChange::Shortcut(ShortcutSettingsChange {
            binding: "control+alt+KeyD".into(),
        }),
    ] {
        config.update_native_settings(root.path(), &input).unwrap();
    }
    let reloaded = read(root.path(), &[], &[]).unwrap();
    assert!(reloaded.native_settings().autostart.value);
    assert_eq!(
        reloaded.native_settings().show_main.value,
        "control+alt+KeyD"
    );
    assert_eq!(
        reloaded.native_settings().autostart.source,
        ConfigSource::File
    );
    assert_eq!(
        serde_json::to_value(config.settings()).unwrap(),
        old_settings
    );
    for key in [
        "autostart.enabled=1",
        "shortcuts.show_main=1",
        "autostart.start_minimized=true",
        "shortcuts.other=Ctrl+D",
    ] {
        assert!(read(root.path(), &[], &[key]).is_err(), "{key}");
    }
    for input in [
        r#"{"type":"autostart","enabled":true,"path":"other.exe"}"#,
        r#"{"type":"shortcut","binding":"Ctrl+Alt+D","action":"hide"}"#,
        r#"{"type":"shortcut","binding":false}"#,
    ] {
        assert!(serde_json::from_str::<NativeSettingsChange>(input).is_err());
    }
    for preset in [
        include_str!("../../../../../presets/minimal.toml"),
        include_str!("../../../../../presets/tool.toml"),
        include_str!("../../../../../presets/full.toml"),
    ] {
        let table = preset.parse::<toml::Table>().unwrap();
        assert_eq!(table["autostart"]["enabled"].as_bool(), Some(false));
        assert_eq!(table["shortcuts"]["show_main"].as_str(), Some(""));
    }
}

#[test]
fn window_setting_sources_and_saved_fact() {
    let root = state_root();
    let mut config = read(root.path(), &[], &[]).unwrap();
    assert!(config.native_settings().restore_state.value);
    assert_eq!(
        config.native_settings().restore_state.source,
        ConfigSource::Default
    );
    let input = NativeSettingsChange::Window(native::WindowSettingsChange {
        restore_state: false,
    });
    config.update_native_settings(root.path(), &input).unwrap();
    let reloaded = read(root.path(), &[], &[]).unwrap();
    assert!(!reloaded.native_settings().restore_state.value);
    assert_eq!(
        reloaded.native_settings().restore_state.source,
        ConfigSource::File
    );
    for (env, cli) in [
        (vec![("TENON__WINDOW__RESTORE_STATE", "true")], vec![]),
        (vec![], vec!["window.restore_state=true"]),
    ] {
        let mut overridden = read(root.path(), &env, &cli).unwrap();
        let before = std::fs::read(root.path().join("config.toml")).unwrap();
        assert_eq!(
            overridden
                .update_native_settings(root.path(), &input)
                .unwrap_err()
                .code(),
            SETTINGS_OVERRIDDEN
        );
        assert!(overridden.native_settings().restore_state.value);
        assert_eq!(
            std::fs::read(root.path().join("config.toml")).unwrap(),
            before
        );
    }
    assert!(read(root.path(), &[], &["window.restore_state=1"]).is_err());
    assert!(read(root.path(), &[], &["window.visible=true"]).is_err());
    assert!(
        serde_json::from_str::<NativeSettingsChange>(
            r#"{"type":"window","restoreState":true,"visible":true}"#
        )
        .is_err()
    );
    let failed_root = root.path().join("missing").join("state");
    assert!(
        config
            .update_native_settings(
                &failed_root,
                &NativeSettingsChange::Window(native::WindowSettingsChange {
                    restore_state: true
                })
            )
            .is_err()
    );
    assert!(!config.native_settings().restore_state.value);
}

#[test]
fn updater_setting_defaults_sources_and_presets() {
    let root = tempfile::tempdir().unwrap();
    let config = super::load(root.path(), [], &[]).unwrap();
    assert!(!config.native_settings().check_on_start.value);
    let config = super::load(
        root.path(),
        [("TENON__UPDATER__CHECK_ON_START".into(), "true".into())],
        &[],
    )
    .unwrap();
    assert!(config.native_settings().check_on_start.value);
    assert_eq!(
        config.native_settings().check_on_start.source,
        super::ConfigSource::Environment
    );
    for (_, preset) in PRESETS {
        let seed = state_root();
        fs::write(seed.path().join("config.toml"), preset).unwrap();
        let config = super::load(seed.path(), [], &[]).unwrap();
        assert!(!config.native_settings().check_on_start.value);
        assert_eq!(
            config.native_settings().check_on_start.source,
            super::ConfigSource::File
        );
    }
}
