//! loading 行为测试。

use super::*;

#[test]
fn module_leaf_sources_follow_case_insensitive_override_keys() {
    let root = state_root();
    fs::write(
        root.path().join("config.toml"),
        "[modules.demo]\nenabled=false\n[modules.account]\n",
    )
    .unwrap();
    let file = read(root.path(), &[], &[]).unwrap();
    assert_eq!(file.source("modules.demo.enabled"), ConfigSource::File);
    assert_eq!(
        file.source("modules.account.enabled"),
        ConfigSource::Default
    );
    assert_eq!(
        file.source_keys(ConfigSource::File),
        ["modules.demo.enabled"]
    );
    let environment = [("tEnOn__MoDuLeS__DeMo__EnAbLeD", "true")];
    let config = read(root.path(), &environment, &["modules.demo.enabled=false"]).unwrap();
    assert!(!config.modules()["demo"].enabled);
    assert_eq!(
        config.source("modules.demo.enabled"),
        ConfigSource::CommandLine
    );
    assert!(config.source_keys(ConfigSource::Environment).is_empty());
    assert!(read(root.path(), &[], &["UI.THEME=dark"]).is_err());
}

#[test]
fn module_inline_table_overrides_replace_leaf_sources() {
    let root = state_root();
    fs::write(
        root.path().join("config.toml"),
        "[modules.demo]\nenabled=false\n",
    )
    .unwrap();
    let environment = [("TENON__MODULES__DEMO", "{ enabled=true }")];
    let config = read(root.path(), &environment, &[]).unwrap();
    assert!(config.modules()["demo"].enabled);
    assert_eq!(
        config.source("modules.demo.enabled"),
        ConfigSource::Environment
    );
    assert!(config.source_keys(ConfigSource::File).is_empty());
    let config = read(root.path(), &environment, &["modules.demo={}"]).unwrap();
    assert!(config.modules()["demo"].enabled);
    assert_eq!(config.source("modules.demo.enabled"), ConfigSource::Default);
    assert!(config.source_keys(ConfigSource::Environment).is_empty());
    assert!(config.source_keys(ConfigSource::CommandLine).is_empty());
}

#[test]
fn former_brand_environment_does_not_override_configuration() {
    let root = state_root();
    let brand = crate::identity::CREDENTIAL_SERVICE
        .split('.')
        .nth(1)
        .unwrap()
        .to_ascii_uppercase();
    let old_key = format!("{brand}__UI__THEME");
    let config = read(root.path(), &[(&old_key, "dark")], &[]).unwrap();
    assert_eq!(config.settings().theme.value, Theme::System);
    assert_eq!(config.settings().theme.source, ConfigSource::Default);
}

#[test]
fn absent_file_uses_defaults_without_creating_file() {
    let root = state_root();
    let loaded = read(root.path(), &[], &[]).unwrap();
    assert_eq!(loaded.values.logging.level, LogLevel::Info);
    assert_eq!(loaded.values.logging.retention_days.get(), 14);
    assert_eq!(loaded.database().kind(), DatabaseKind::Sqlite);
    assert_eq!(loaded.database().backup_keep.get(), 5);
    assert!(!loaded.sources.file_exists);
    assert!(loaded.sources.keys(ConfigSource::Environment).is_empty());
    assert!(loaded.sources.keys(ConfigSource::CommandLine).is_empty());
    assert!(!root.path().join("config.toml").exists());
}

#[test]
fn file_overrides_defaults_and_missing_fields_keep_defaults() {
    let root = state_root();
    fs::write(
        root.path().join("config.toml"),
        "[logging]\nlevel = 'warn'\n",
    )
    .unwrap();
    let loaded = read(root.path(), &[], &[]).unwrap();
    assert_eq!(loaded.values.logging.level, LogLevel::Warn);
    assert_eq!(loaded.values.logging.retention_days.get(), 14);
    assert!(loaded.sources.file_exists);
    fs::write(
        root.path().join("config.toml"),
        "[logging]\nlevel = 'error'\nretention_days = 3\n",
    )
    .unwrap();
    let loaded = read(root.path(), &[], &[]).unwrap();
    assert_eq!(loaded.values.logging.level, LogLevel::Error);
    assert_eq!(loaded.values.logging.retention_days.get(), 3);
}

#[test]
fn environment_overrides_file_with_case_insensitive_keys() {
    let root = state_root();
    fs::write(
        root.path().join("config.toml"),
        "[logging]\nlevel = 'warn'\nretention_days = 5\n",
    )
    .unwrap();
    let loaded = read(root.path(), &[("tEnOn__LoGgInG__LeVeL", "debug")], &[]).unwrap();
    assert_eq!(loaded.values.logging.level, LogLevel::Debug);
    assert_eq!(loaded.values.logging.retention_days.get(), 5);
    assert_eq!(
        loaded.sources.keys(ConfigSource::Environment),
        ["logging.level"]
    );
}

#[test]
fn command_line_overrides_environment_and_reports_only_effective_sources() {
    let root = state_root();
    let loaded = read(
        root.path(),
        &[
            ("TENON__LOGGING__LEVEL", "debug"),
            ("TENON__LOGGING__RETENTION_DAYS", "7"),
        ],
        &["logging.level=warn", "logging.level=trace"],
    )
    .unwrap();
    assert_eq!(loaded.values.logging.level, LogLevel::Trace);
    assert_eq!(loaded.values.logging.retention_days.get(), 7);
    assert_eq!(
        loaded.sources.keys(ConfigSource::Environment),
        ["logging.retention_days"]
    );
    assert_eq!(
        loaded.sources.keys(ConfigSource::CommandLine),
        ["logging.level"]
    );
}

#[test]
fn overrides_parse_toml_literals_before_plain_strings() {
    let root = state_root();
    let loaded = read(
        root.path(),
        &[],
        &["logging.level=\"debug\"", "logging.retention_days=21"],
    )
    .unwrap();
    assert_eq!(loaded.values.logging.level, LogLevel::Debug);
    assert_eq!(loaded.values.logging.retention_days.get(), 21);
    let error = read(root.path(), &[], &["logging.level=true"]).unwrap_err();
    assert!(matches!(error, ConfigError::Field { ref path, .. } if path == "logging.level"));
    let error = read(root.path(), &[], &["logging.level=de=bug"]).unwrap_err();
    assert!(matches!(error, ConfigError::Field { ref path, .. } if path == "logging.level"));
}

#[test]
fn unknown_sections_and_keys_include_field_paths() {
    let root = state_root();
    for (text, expected) in [
        ("[unused]\nkey = 1", "unused"),
        ("[logging]\nunknown = true", "logging.unknown"),
    ] {
        fs::write(root.path().join("config.toml"), text).unwrap();
        let error = read(root.path(), &[], &[]).unwrap_err();
        assert!(
            matches!(error, ConfigError::Field { ref path, .. } if path == expected),
            "{error}"
        );
    }
}

#[test]
fn invalid_values_include_field_paths() {
    let root = state_root();
    for value in ["0", "-1", "1.5", "'14'", "false"] {
        fs::write(
            root.path().join("config.toml"),
            format!("[logging]\nretention_days = {value}"),
        )
        .unwrap();
        let error = read(root.path(), &[], &[]).unwrap_err();
        assert!(
            matches!(error, ConfigError::Field { ref path, .. } if path == "logging.retention_days"),
            "{error}"
        );
    }
    fs::write(
        root.path().join("config.toml"),
        "[logging]\nlevel = 'verbose'",
    )
    .unwrap();
    let error = read(root.path(), &[], &[]).unwrap_err();
    assert!(
        matches!(error, ConfigError::Field { ref path, .. } if path == "logging.level"),
        "{error}"
    );
}

#[test]
fn invalid_override_values_and_unknown_keys_include_field_paths() {
    let root = state_root();
    for (raw, expected) in [
        ("logging.retention_days=0", "logging.retention_days"),
        ("logging.level=verbose", "logging.level"),
        ("logging.unknown=14", "logging.unknown"),
        ("unknown.level=info", "unknown"),
    ] {
        let error = read(root.path(), &[], &[raw]).unwrap_err();
        assert!(
            matches!(error, ConfigError::Field { ref path, .. } if path == expected),
            "{error}"
        );
    }
}

#[test]
fn malformed_command_line_overrides_report_source_and_raw_text() {
    let root = state_root();
    for raw in [
        "logging",
        "logging=info",
        "logging..level=info",
        "logging.level.more=info",
        ".level=info",
        "logging.=info",
    ] {
        let error = read(root.path(), &[], &[raw]).unwrap_err();
        assert!(
            matches!(error, ConfigError::Override { origin: "--set", raw: ref actual } if actual == raw),
            "{error}"
        );
    }
}

#[test]
fn malformed_environment_overrides_report_source_and_raw_text() {
    let root = state_root();
    for name in [
        "TENON__LOGGING",
        "TENON__LOGGING__",
        "TENON__LOGGING__LEVEL__MORE",
        "TENON__logging.level",
    ] {
        let error = read(root.path(), &[(name, "info")], &[]).unwrap_err();
        assert!(
            matches!(error, ConfigError::Override { origin: "环境变量", ref raw } if raw == &format!("{name}=info")),
            "{error}"
        );
    }
}

#[test]
fn unrelated_environment_variables_are_ignored() {
    let root = state_root();
    let loaded = read(
        root.path(),
        &[
            ("TENON_STATE_ROOT", "another-state"),
            ("TENON_LOGGING_LEVEL", "error"),
            ("OTHER__LOGGING__LEVEL", "warn"),
            ("logging.level", "trace"),
            ("PATH", "unused"),
        ],
        &[],
    )
    .unwrap();
    assert_eq!(loaded.values.logging.level, LogLevel::Info);
    assert!(loaded.sources.keys(ConfigSource::Environment).is_empty());
}

#[test]
fn syntax_errors_include_file_path_and_location() {
    let root = state_root();
    let expected_path = root.path().join("config.toml");
    fs::write(&expected_path, "[logging]\nlevel = [").unwrap();
    let error = read(root.path(), &[], &[]).unwrap_err();
    assert!(error.to_string().contains("line 2"), "{error}");
    assert!(
        matches!(error, ConfigError::Syntax { ref path, ref source } if path == &expected_path && source.span().is_some())
    );
}

#[test]
fn unreadable_file_reports_path_instead_of_using_defaults() {
    let root = state_root();
    let expected_path = root.path().join("config.toml");
    fs::create_dir(&expected_path).unwrap();
    let error = read(root.path(), &[], &[]).unwrap_err();
    assert!(matches!(error, ConfigError::Read { ref path, .. } if path == &expected_path));
}

#[test]
fn override_does_not_hide_a_non_table_section() {
    let root = state_root();
    fs::write(root.path().join("config.toml"), "logging = false").unwrap();
    let error = read(root.path(), &[], &["logging.level=info"]).unwrap_err();
    assert!(matches!(error, ConfigError::Field { ref path, .. } if path == "logging"));
}
