//! settings 行为测试。

use super::*;

#[test]
fn ui_defaults_sources_and_strict_values() {
    let root = state_root();
    let mut config = read(root.path(), &[], &[]).unwrap();
    assert_eq!(config.settings().theme.value, Theme::System);
    assert_eq!(config.settings().language.value, Language::ZhCn);
    assert!(!config.settings().developer_mode.value);
    for theme in [Theme::Light, Theme::Dark, Theme::System] {
        let input = AppSettingsUpdate {
            theme: Some(theme),
            language: Some(Language::EnUs),
            developer_mode: Some(true),
            ..Default::default()
        };
        let settings = config.update_settings(root.path(), &input).unwrap();
        assert_eq!(settings.theme.value, theme);
        assert_eq!(settings.theme.source, ConfigSource::File);
        let reopened = read(root.path(), &[], &[]).unwrap();
        assert_eq!(reopened.settings().theme.value, theme);
        assert_eq!(reopened.language(), Language::EnUs);
        assert!(reopened.settings().developer_mode.value);
    }
    for (name, text) in PRESETS {
        fs::write(root.path().join("config.toml"), text).unwrap();
        let seed = read(root.path(), &[], &[]).unwrap();
        assert_eq!(seed.settings().theme.value, Theme::System, "{name}");
        assert_eq!(seed.settings().theme.source, ConfigSource::File);
        assert_eq!(
            seed.auth_mode(),
            if name == "full" {
                AuthMode::Login
            } else {
                AuthMode::None
            }
        );
        let enabled = seed
            .modules()
            .iter()
            .filter_map(|(key, value)| value.enabled.then_some(key.as_str()))
            .collect::<Vec<_>>();
        let expected = match name {
            "minimal" => vec!["account"],
            "tool" => vec!["account", "notify"],
            "full" => vec!["account", "demo", "devtools", "files", "notify"],
            _ => panic!("unexpected preset"),
        };
        assert_eq!(enabled, expected);
        assert_eq!(
            text.parse::<Table>().unwrap()["ui"]
                .as_table()
                .unwrap()
                .len(),
            3
        );
    }
}

#[test]
fn ui_update_rejects_overrides_for_the_whole_batch() {
    let root = state_root();
    let path = root.path().join("config.toml");
    let text = "# saved\n[ui]\ntheme = 'system'\n";
    fs::write(&path, text).unwrap();
    for (environment, overrides, source) in [
        (
            vec![("TENON__UI__THEME", "dark")],
            vec![],
            ConfigSource::Environment,
        ),
        (vec![], vec!["ui.theme=dark"], ConfigSource::CommandLine),
    ] {
        let mut config = read(root.path(), &environment, &overrides).unwrap();
        let before = serde_json::to_value(config.settings()).unwrap();
        assert_eq!(config.settings().theme.source, source);
        for theme in [Theme::Light, Theme::Dark] {
            let input = AppSettingsUpdate {
                theme: Some(theme),
                language: Some(Language::EnUs),
                ..Default::default()
            };
            let error = config.update_settings(root.path(), &input).unwrap_err();
            assert_eq!(error.code(), SETTINGS_OVERRIDDEN);
            assert_eq!(error.params()["key"], "ui.theme");
            assert_eq!(serde_json::to_value(config.settings()).unwrap(), before);
            assert_eq!(fs::read_to_string(&path).unwrap(), text);
        }
    }
}

#[test]
fn settings_dto_rejects_invalid_and_deferred_fields() {
    for input in [
        r#"{"language":"fr-FR"}"#,
        r#"{"theme":"auto"}"#,
        r#"{"theme":true}"#,
        r#"{"logLevel":"verbose"}"#,
        r#"{"developerMode":1}"#,
        r#"{"unknown":true}"#,
        r#"{"userAdjustable":[]}"#,
        r#"{"accent":"azure"}"#,
    ] {
        assert!(
            serde_json::from_str::<AppSettingsUpdate>(input).is_err(),
            "{input}"
        );
    }
    let root = state_root();
    for value in [
        "ui.user_adjustable=[]",
        "ui.accent=azure",
        "ui.theme_style=standard",
        "ui.preset=console",
        "ui.background=solid",
    ] {
        assert!(read(root.path(), &[], &[value]).is_err(), "{value}");
    }
}

#[test]
fn settings_report_default_file_environment_and_command_line_sources() {
    let root = state_root();
    let settings = read(root.path(), &[], &[]).unwrap().settings();
    assert_eq!(settings.language.value, Language::ZhCn);
    assert_eq!(settings.theme.value, Theme::System);
    assert_eq!(settings.language.source, ConfigSource::Default);
    assert_eq!(settings.theme.source, ConfigSource::Default);
    assert_eq!(settings.log_level.source, ConfigSource::Default);
    fs::write(
        root.path().join("config.toml"),
        "[ui]\nlanguage = 'en-US'\ntheme = 'dark'\n",
    )
    .unwrap();
    let settings = read(
        root.path(),
        &[
            ("TENON__UI__THEME", "light"),
            ("TENON__LOGGING__LEVEL", "warn"),
        ],
        &["logging.level=error"],
    )
    .unwrap()
    .settings();
    assert_eq!(settings.language.value, Language::EnUs);
    assert_eq!(settings.language.source, ConfigSource::File);
    assert_eq!(settings.theme.value, Theme::Light);
    assert_eq!(settings.theme.source, ConfigSource::Environment);
    assert_eq!(settings.log_level.value, LogLevel::Error);
    assert_eq!(settings.log_level.source, ConfigSource::CommandLine);
}

#[test]
fn settings_update_preserves_comments_other_keys_and_inline_tables() {
    for original in [
        "# preferences\n[ui] # display\nlanguage = 'en-US' # keep language\ntheme  = 'system' # keep theme\n\n[logging]\nlevel = 'warn' # severity\nretention_days = 7\n",
        "# inline\nui = { language = 'en-US', theme = 'system' } # display\n[logging]\nretention_days = 7 # days\n",
    ] {
        let root = state_root();
        let path = root.path().join("config.toml");
        fs::write(&path, original).unwrap();
        let mut loaded = read(root.path(), &[], &[]).unwrap();
        loaded
            .update_settings(
                root.path(),
                &AppSettingsUpdate {
                    theme: Some(Theme::Dark),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            original.replace("'system'", "\"dark\"")
        );
        assert_eq!(
            read(root.path(), &[], &[]).unwrap().settings().theme.value,
            Theme::Dark
        );
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
}

#[test]
fn settings_update_creates_missing_file_with_only_modified_keys() {
    let root = state_root();
    let mut loaded = read(root.path(), &[], &[]).unwrap();
    let update = AppSettingsUpdate {
        language: Some(Language::EnUs),
        log_level: Some(LogLevel::Debug),
        ..Default::default()
    };
    let settings = loaded.update_settings(root.path(), &update).unwrap();
    assert_eq!(settings.language.source, ConfigSource::File);
    assert_eq!(settings.log_level.source, ConfigSource::File);
    assert_eq!(settings.theme.source, ConfigSource::Default);
    assert!(loaded.file_exists());
    let text = fs::read_to_string(root.path().join("config.toml")).unwrap();
    assert!(!text.contains("theme"));
    assert!(!text.contains("retention_days"));
    let restarted = read(root.path(), &[], &[]).unwrap().settings();
    assert_eq!(restarted.language.value, Language::EnUs);
    assert_eq!(restarted.log_level.value, LogLevel::Debug);
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn settings_update_rejects_overridden_keys_without_partial_changes() {
    for (environment, overrides) in [
        (vec![("TENON__LOGGING__LEVEL", "warn")], vec![]),
        (vec![], vec!["logging.level=warn"]),
    ] {
        let root = state_root();
        let mut loaded = read(root.path(), &environment, &overrides).unwrap();
        let error = loaded
            .update_settings(
                root.path(),
                &AppSettingsUpdate {
                    theme: Some(Theme::Dark),
                    log_level: Some(LogLevel::Warn),
                    ..Default::default()
                },
            )
            .unwrap_err();
        assert_eq!(error.code().as_str(), "app.settings.overridden");
        assert_eq!(error.params()["key"], "logging.level");
        assert_eq!(loaded.settings().theme.value, Theme::System);
        assert!(!root.path().join("config.toml").exists());
    }
}

#[test]
fn empty_or_unchanged_update_does_not_create_or_reformat_file() {
    let root = state_root();
    let mut loaded = read(root.path(), &[], &[]).unwrap();
    loaded
        .update_settings(root.path(), &AppSettingsUpdate::default())
        .unwrap();
    loaded
        .update_settings(
            root.path(),
            &AppSettingsUpdate {
                theme: Some(Theme::System),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(!root.path().join("config.toml").exists());
    let original = "[ui]\ntheme = 'dark' # preserved\n";
    fs::write(root.path().join("config.toml"), original).unwrap();
    let mut loaded = read(root.path(), &[], &[]).unwrap();
    loaded
        .update_settings(
            root.path(),
            &AppSettingsUpdate {
                theme: Some(Theme::Dark),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("config.toml")).unwrap(),
        original
    );
}

#[test]
fn ui_load_rejects_unknown_fields_and_invalid_enum_values() {
    let root = state_root();
    for (text, expected) in [
        ("[ui]\nlanguage = 'fr-FR'", "ui.language"),
        ("[ui]\ntheme = 'auto'", "ui.theme"),
        ("[ui]\nunused = true", "ui.unused"),
    ] {
        fs::write(root.path().join("config.toml"), text).unwrap();
        assert!(
            matches!(read(root.path(), &[], &[]).unwrap_err(), ConfigError::Field { path, .. } if path == expected)
        );
    }
}

#[test]
#[cfg(windows)]
fn failed_atomic_replace_keeps_file_memory_and_cleans_temporary_file() {
    let root = state_root();
    let path = root.path().join("config.toml");
    let original = "[ui]\ntheme = 'light' # keep\n";
    fs::write(&path, original).unwrap();
    let mut loaded = read(root.path(), &[], &[]).unwrap();
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    let result = loaded.update_settings(
        root.path(),
        &AppSettingsUpdate {
            theme: Some(Theme::Dark),
            ..Default::default()
        },
    );
    fs::set_permissions(&path, permissions).unwrap();
    assert_eq!(
        result.unwrap_err().code().as_str(),
        "app.internal.unexpected"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    assert_eq!(loaded.settings().theme.value, Theme::Light);
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}
